import useSWR from "swr";
import axios from "@/lib/axios";

export interface Tenant {
  id: number;
  name: string;
  code: string;
  status: string;
  max_users: number;
  created_at: string;
  updated_at: string;
}

export interface Department {
  id: number;
  tenant_id: number;
  parent_id?: number;
  name: string;
  code: string;
  level: number;
  path: string;
  status: string;
  created_at: string;
  updated_at: string;
  parent_name?: string;
  tenant_name?: string;
}

export interface DatasetWithOrg {
  id: string;
  name: string;
  visibility: string;
  file_count?: number;
  updated_at: string;
  created_at?: string;
  owner_tenant_id?: number;
  owner_dept_id?: number;
  owner_tenant_name?: string;
  owner_dept_name?: string;
  owner_name?: string;
  color?: string;
  settings?: {
    splitMode?: string;
    fixedLength?: number;
    segmentModel?: string;
    contentParsing?: string;
    enhanced?: boolean;
    promptType?: string;
    vectorWeight?: number;
    textWeight?: number;
    rerankService?: string;
  };
}

// 数据获取函数
const fetcher = async (url: string) => {
  const response = await axios.get(url);
  return response.data;
};

export const useOrganization = () => {
  // 获取租户列表
  const {
    data: tenantsData,
    error: tenantsError,
    isLoading: tenantsLoading,
  } = useSWR<{ tenants?: Tenant[]; tenant?: Tenant }>("/api/organization/tenants", fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
  });

  // 获取部门列表
  const {
    data: deptsData,
    error: deptsError,
    isLoading: deptsLoading,
  } = useSWR<{ depts: Department[] }>("/api/organization/depts", fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
  });

  // 获取数据集列表（带组织信息）
  const {
    data: datasetsData,
    error: datasetsError,
    isLoading: datasetsLoading,
  } = useSWR<DatasetWithOrg[]>("/api/datasets", fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
  });

  // 处理租户数据
  const tenants = tenantsData?.tenants || (tenantsData?.tenant ? [tenantsData.tenant] : []);

  // 处理部门数据
  const departments = deptsData?.depts || [];

  // 处理数据集数据
  const datasets = datasetsData || [];

  // 按租户和部门组织数据集
  const organizedDatasets = () => {
    const result: {
      [tenantId: number]: {
        tenant: Tenant;
        departments: {
          [deptId: number]: {
            department: Department;
            datasets: DatasetWithOrg[];
          };
        };
        datasets: DatasetWithOrg[]; // 租户级别的数据集
      };
    } = {};

    // 初始化租户结构
    tenants.forEach((tenant) => {
      result[tenant.id] = {
        tenant,
        departments: {},
        datasets: [],
      };
    });

    // 初始化部门结构
    departments.forEach((dept) => {
      if (result[dept.tenant_id]) {
        result[dept.tenant_id].departments[dept.id] = {
          department: dept,
          datasets: [],
        };
      }
    });

    // 分配数据集到对应的租户和部门
    datasets.forEach((dataset) => {
      if (dataset.owner_tenant_id && result[dataset.owner_tenant_id]) {
        if (
          dataset.owner_dept_id &&
          result[dataset.owner_tenant_id].departments[dataset.owner_dept_id]
        ) {
          // 分配到部门
          result[dataset.owner_tenant_id].departments[dataset.owner_dept_id].datasets.push(dataset);
        } else {
          // 分配到租户级别
          result[dataset.owner_tenant_id].datasets.push(dataset);
        }
      }
    });

    return result;
  };

  return {
    tenants,
    departments,
    datasets,
    organizedDatasets: organizedDatasets(),
    loading: tenantsLoading || deptsLoading || datasetsLoading,
    error: tenantsError || deptsError || datasetsError,
  };
};
