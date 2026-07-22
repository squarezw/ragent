"use client";

import React from "react";
import { useTranslations } from "next-intl";

interface Dept {
  id: number;
  name: string;
  tenant_id: number;
  tenant_name?: string;
  parent_id?: number | null;
  children?: Dept[];
}

interface DeptSelectProps {
  depts: Dept[];
  value: number | null;
  onChange: (deptId: number | null) => void;
  disabled?: boolean;
  placeholder?: string;
  excludeDeptId?: number; // 排除特定部门（用于编辑时不能选择自己作为父部门）
  className?: string;
  id?: string;
}

// 构建部门树状结构
const buildDeptTree = (depts: Dept[]) => {
  const deptMap = new Map();
  const rootDepts: Dept[] = [];

  depts.forEach((dept) => {
    deptMap.set(dept.id, { ...dept, children: [] });
  });

  depts.forEach((dept) => {
    if (dept.parent_id) {
      const parent = deptMap.get(dept.parent_id);
      if (parent) {
        parent.children.push(deptMap.get(dept.id));
      }
    } else {
      rootDepts.push(deptMap.get(dept.id));
    }
  });

  return rootDepts;
};

// 生成树型部门选项
const generateDeptOptions = (depts: Dept[], level = 0, excludeDeptId?: number) => {
  const options: React.ReactElement[] = [];

  depts.forEach((dept) => {
    // 排除指定部门
    if (excludeDeptId && dept.id === excludeDeptId) {
      return;
    }

    const prefix = "　".repeat(level); // 使用全角空格作为缩进
    const displayName = dept.name; // 只显示部门名称，不显示租户前缀

    options.push(
      <option key={dept.id} value={dept.id}>
        {prefix}
        {displayName}
      </option>
    );

    // 递归添加子部门
    if (dept.children && dept.children.length > 0) {
      options.push(...generateDeptOptions(dept.children, level + 1, excludeDeptId));
    }
  });

  return options;
};

export default function DeptSelect({
  depts,
  value,
  onChange,
  disabled = false,
  placeholder,
  excludeDeptId,
  className = "w-full border rounded px-2 py-1",
  id,
}: DeptSelectProps) {
  const t = useTranslations("common");
  const deptTree = buildDeptTree(depts);
  const placeholderText = placeholder || t("selectDepartment");

  return (
    <select
      id={id}
      className={className}
      value={value || ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      disabled={disabled}
    >
      <option value="">{placeholderText}</option>
      {generateDeptOptions(deptTree, 0, excludeDeptId)}
    </select>
  );
}
