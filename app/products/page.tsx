"use client";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Plus, Search, Upload, Edit, Trash2, Download, FileSpreadsheet } from "lucide-react";
import axios from "@/lib/axios";
import { toast } from "sonner";
import { Pagination, PaginationData } from "@/components/ui/pagination";
import { useTranslations } from "next-intl";

interface Product {
  id: number;
  sn: string;
  name: string;
  category: string;
  material: string;
  spec: string;
  description: string;
  memo: string;
  created_at: string;
  updated_at: string;
  embedding_status?: string;
  embedding_text?: string;
  similarity?: number;
}

interface ImportResult {
  row: number;
  success: boolean;
  data?: any;
  error?: string;
}

export default function ProductsPage() {
  const t = useTranslations("products");
  const tc = useTranslations("common");
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searchType, setSearchType] = useState<"fuzzy" | "vector">("vector");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [segmentFilter, setSegmentFilter] = useState("all");
  const [pagination, setPagination] = useState<PaginationData>({
    page: 1,
    total: 0,
    total_pages: 1,
  });
  const [pageSize] = useState(30);

  // 批量删除状态
  const [selectedProducts, setSelectedProducts] = useState<number[]>([]);
  const [isSelectAll, setIsSelectAll] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // 表单状态
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [formData, setFormData] = useState({
    sn: "",
    name: "",
    category: "",
    material: "",
    spec: "",
    description: "",
    memo: "",
  });

  // 导入状态
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState<ImportResult[]>([]);

  // 分段状态统计
  const [segmentStats, setSegmentStats] = useState({
    completed: 0,
    pending: 0,
    processing: 0,
    failed: 0,
    skipped: 0,
    total: 0,
  });

  // 获取分段状态显示
  const getSegmentStatusDisplay = (status?: string) => {
    switch (status) {
      case "completed":
        return {
          text: t("completed"),
          variant: "default" as const,
          className: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
        };
      case "pending":
        return {
          text: t("pending"),
          variant: "secondary" as const,
          className: "bg-muted text-muted-foreground",
        };
      case "processing":
        return {
          text: t("processing"),
          variant: "secondary" as const,
          className: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
        };
      case "failed":
        return {
          text: t("failed"),
          variant: "destructive" as const,
          className: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200",
        };
      case "skipped":
        return {
          text: t("skipped"),
          variant: "outline" as const,
          className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
        };
      default:
        return {
          text: t("unknown"),
          variant: "secondary" as const,
          className: "bg-muted text-muted-foreground",
        };
    }
  };

  // 计算分段统计
  const calculateSegmentStats = (products: Product[]) => {
    const stats = {
      completed: 0,
      pending: 0,
      processing: 0,
      failed: 0,
      skipped: 0,
      total: products.length,
    };

    products.forEach((product) => {
      const status = product.embedding_status || "pending";
      switch (status) {
        case "completed":
          stats.completed++;
          break;
        case "pending":
          stats.pending++;
          break;
        case "processing":
          stats.processing++;
          break;
        case "failed":
          stats.failed++;
          break;
        case "skipped":
          stats.skipped++;
          break;
        default:
          stats.pending++;
      }
    });

    return stats;
  };

  // 获取产品列表
  const fetchProducts = async () => {
    setLoading(true);
    try {
      let response;

      if (searchTerm && searchType === "vector") {
        // 向量搜索
        response = await axios.post("/api/products/vector-search", {
          query: searchTerm,
          limit: pageSize,
          embedding_status: segmentFilter !== "all" ? segmentFilter : undefined,
        });

        // 向量搜索返回的是直接的产品数组
        setProducts(response.data.products || []);
        setPagination({
          page: 1,
          total: response.data.total || 0,
          total_pages: Math.ceil((response.data.total || 0) / pageSize),
        });
      } else {
        // 模糊搜索或普通列表
        const params = new URLSearchParams({
          page: pagination.page.toString(),
          limit: pageSize.toString(),
          ...(searchTerm && { search: searchTerm }),
          ...(categoryFilter && categoryFilter !== "all" && { category: categoryFilter }),
          ...(segmentFilter && segmentFilter !== "all" && { embedding_status: segmentFilter }),
        });

        response = await axios.get(`/api/products?${params}`);
        setProducts(response.data.data);
        setPagination({
          page: response.data.pagination.page || 1,
          total: response.data.pagination.total || 0,
          total_pages: response.data.pagination.totalPages || 1,
        });
      }

      // 计算分段统计
      const stats = calculateSegmentStats(response.data.data || response.data.products || []);
      setSegmentStats(stats);
    } catch (error) {
      console.error("Failed to fetch products:", error);
      toast.error(t("fetchFailed"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, [pagination.page, searchTerm, searchType, categoryFilter, segmentFilter]);

  // 监听选择的产品变化，更新全选状态
  useEffect(() => {
    if (products.length > 0 && selectedProducts.length === products.length) {
      setIsSelectAll(true);
    } else {
      setIsSelectAll(false);
    }
  }, [selectedProducts, products]);

  // 在搜索或筛选条件改变时重置选择状态
  useEffect(() => {
    setSelectedProducts([]);
    setIsSelectAll(false);
  }, [searchTerm, searchType, categoryFilter, segmentFilter]);

  // 重置表单
  const resetForm = () => {
    setFormData({
      sn: "",
      name: "",
      category: "",
      material: "",
      spec: "",
      description: "",
      memo: "",
    });
    setEditingProduct(null);
  };

  // 重置筛选条件
  const resetFilters = () => {
    setSearchTerm("");
    setSearchType("vector");
    setCategoryFilter("all");
    setSegmentFilter("all");
    setPagination((prev) => ({ ...prev, page: 1 }));
  };

  // 打开新增对话框
  const openAddDialog = () => {
    resetForm();
    setIsAddDialogOpen(true);
  };

  // 打开编辑对话框
  const openEditDialog = (product: Product) => {
    setEditingProduct(product);
    setFormData({
      sn: product.sn,
      name: product.name,
      category: product.category,
      material: product.material,
      spec: product.spec,
      description: product.description,
      memo: product.memo,
    });
    setIsEditDialogOpen(true);
  };

  // 保存产品
  const saveProduct = async () => {
    try {
      if (editingProduct) {
        await axios.put(`/api/products/${editingProduct.id}`, formData);
        toast.success(t("updateSuccess"));
        setIsEditDialogOpen(false);
      } else {
        await axios.post("/api/products", formData);
        toast.success(t("createSuccess"));
        setIsAddDialogOpen(false);
      }
      resetForm();
      fetchProducts();
    } catch (error: any) {
      console.error("Failed to save product:", error);
      toast.error(error.response?.data?.error || t("saveFailed"));
    }
  };

  // 删除产品
  const deleteProduct = async (id: number) => {
    if (!confirm(t("deleteConfirm"))) return;

    try {
      await axios.delete(`/api/products/${id}`);
      toast.success(t("deleteSuccess"));
      fetchProducts();
    } catch (error) {
      console.error("Failed to delete product:", error);
      toast.error(t("deleteFailed"));
    }
  };

  // 批量删除产品
  const deleteSelectedProducts = async () => {
    if (selectedProducts.length === 0) {
      toast.error(t("selectProductsToDelete"));
      return;
    }

    if (!confirm(t("batchDeleteConfirm", { count: selectedProducts.length }))) {
      return;
    }

    setDeleting(true);
    try {
      await axios.delete("/api/products/batch", {
        data: { ids: selectedProducts },
      });
      toast.success(t("batchDeleteSuccess", { count: selectedProducts.length }));
      setSelectedProducts([]);
      setIsSelectAll(false);
      fetchProducts();
    } catch (error: any) {
      console.error("Failed to delete products:", error);
      toast.error(error.response?.data?.error || t("batchDeleteFailed"));
    } finally {
      setDeleting(false);
    }
  };

  // 选择/取消选择单个产品
  const toggleProductSelection = (productId: number) => {
    setSelectedProducts((prev) => {
      if (prev.includes(productId)) {
        return prev.filter((id) => id !== productId);
      } else {
        return [...prev, productId];
      }
    });
  };

  // 全选/取消全选
  const toggleSelectAll = () => {
    if (isSelectAll) {
      setSelectedProducts([]);
      setIsSelectAll(false);
    } else {
      setSelectedProducts(products.map((p) => p.id));
      setIsSelectAll(true);
    }
  };

  // 清空选择
  const clearSelection = () => {
    setSelectedProducts([]);
    setIsSelectAll(false);
  };

  // 处理文件上传
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      console.log("File selected:", {
        name: file.name,
        size: file.size,
        type: file.type,
      });

      // 验证文件类型
      if (!file.name.match(/\.(xlsx|xls)$/i)) {
        toast.error(t("selectExcelFileOnly"));
        e.target.value = "";
        return;
      }

      setImportFile(file);
      toast.success(t("fileSelectSuccess"));
    }
  };

  // 批量导入
  const handleImport = async () => {
    if (!importFile) {
      toast.error(t("selectFileToImport"));
      return;
    }

    console.log("Starting import with file:", {
      name: importFile.name,
      size: importFile.size,
      type: importFile.type,
    });

    setImporting(true);
    const formData = new FormData();
    formData.append("file", importFile);

    try {
      console.log("Sending import request...");
      const response = await axios.post("/api/products/import", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });

      console.log("Import response:", response.data);

      // 处理导入结果
      if (response.data.successful > 0) {
        if (response.data.errors && response.data.errors.length > 0) {
          setImportResults([...response.data.results, ...response.data.errors]);
          toast.success(
            t("importSuccessWithErrors", {
              success: response.data.successful,
              errors: response.data.errors.length,
            })
          );
        } else {
          toast.success(t("importSuccess", { count: response.data.successful }));
          setIsImportDialogOpen(false);
          setImportFile(null);
          fetchProducts();
        }
      } else if (response.data.errors && response.data.errors.length > 0) {
        setImportResults(response.data.errors);
        toast.error(t("importFailedAllErrors"));
      } else {
        toast.error(t("importFailedUnknown"));
      }
    } catch (error: any) {
      console.error("Import failed:", error);
      console.error("Error response:", error.response?.data);

      if (error.response?.status === 400) {
        if (error.response.data.errors && error.response.data.errors.length > 0) {
          setImportResults(error.response.data.errors);
          toast.error(t("importCompletedWithErrors", { count: error.response.data.errors.length }));
        } else {
          toast.error(error.response.data.error || t("saveFailed"));
        }
      } else {
        toast.error(error.response?.data?.error || t("saveFailed"));
      }
    } finally {
      setImporting(false);
    }
  };

  // 下载模板
  const downloadTemplate = async () => {
    try {
      const response = await axios.get("/api/products/template", {
        responseType: "blob",
      });

      const blob = new Blob([response.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "products_template.xlsx";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast.success(t("templateDownloadSuccess"));
    } catch (error) {
      console.error("Failed to download template:", error);
      toast.error(t("templateDownloadFailed"));
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <div className="flex gap-2">
          <Button onClick={openAddDialog}>
            <Plus className="w-4 h-4 mr-2" />
            {t("addProduct")}
          </Button>
          <Button variant="outline" onClick={() => setIsImportDialogOpen(true)}>
            <Upload className="w-4 h-4 mr-2" />
            {t("batchImport")}
          </Button>
          <Button variant="outline" onClick={downloadTemplate}>
            <Download className="w-4 h-4 mr-2" />
            {t("downloadTemplate")}
          </Button>
        </div>
      </div>

      {/* 搜索和筛选 */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4">
            <div className="flex-1">
              <Input
                placeholder={
                  searchType === "vector"
                    ? t("vectorSearchPlaceholder")
                    : t("fuzzySearchPlaceholder")
                }
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="max-w-md"
              />
            </div>
            <Select
              value={searchType}
              onValueChange={(value: "fuzzy" | "vector") => setSearchType(value)}
            >
              <SelectTrigger className="w-32">
                <SelectValue placeholder={t("searchType")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vector">{t("vectorSearch")}</SelectItem>
                <SelectItem value="fuzzy">{t("fuzzySearch")}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder={t("selectCategory")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allCategories")}</SelectItem>
                <SelectItem value="卫生泵">{t("categorySanitaryPump")}</SelectItem>
                <SelectItem value="YKH离心泵">{t("categoryYkhPump")}</SelectItem>
                <SelectItem value="成品">{t("categoryFinished")}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={segmentFilter} onValueChange={setSegmentFilter}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder={t("selectSegmentStatus")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("allStatus")}</SelectItem>
                <SelectItem value="completed">{t("completed")}</SelectItem>
                <SelectItem value="pending">{t("pending")}</SelectItem>
                <SelectItem value="processing">{t("processing")}</SelectItem>
                <SelectItem value="failed">{t("failed")}</SelectItem>
                <SelectItem value="skipped">{t("skipped")}</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={fetchProducts}>
              <Search className="w-4 h-4 mr-2" />
              {tc("search")}
            </Button>
            <Button variant="outline" onClick={resetFilters}>
              {t("reset")}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 产品列表 */}
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>
              {t("productList")} ({pagination.total})
            </CardTitle>
            {selectedProducts.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {t("selected")} {selectedProducts.length} {t("products")}
                  {(() => {
                    const currentPageCount = selectedProducts.filter((id) =>
                      products.some((p) => p.id === id)
                    ).length;
                    return currentPageCount !== selectedProducts.length
                      ? ` (${t("currentPage")}: ${currentPageCount})`
                      : "";
                  })()}
                </span>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={deleteSelectedProducts}
                  disabled={deleting}
                >
                  {deleting ? t("deleting") : `${t("deleteSelected")} (${selectedProducts.length})`}
                </Button>
                <Button variant="outline" size="sm" onClick={clearSelection}>
                  {t("clearSelection")}
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground mx-auto mb-2"></div>
              <div className="text-muted-foreground">{tc("loading")}</div>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">
                      <input
                        type="checkbox"
                        checked={isSelectAll}
                        onChange={toggleSelectAll}
                        className="rounded border-border"
                      />
                    </TableHead>
                    <TableHead>{t("sn")}</TableHead>
                    <TableHead>{t("productName")}</TableHead>
                    <TableHead>{t("category")}</TableHead>
                    <TableHead>{t("material")}</TableHead>
                    <TableHead>{t("spec")}</TableHead>
                    <TableHead>{t("segmentStatus")}</TableHead>
                    {searchType === "vector" && searchTerm && (
                      <TableHead>{t("similarity")}</TableHead>
                    )}
                    <TableHead>{t("createdTime")}</TableHead>
                    <TableHead>{t("actions")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={searchType === "vector" && searchTerm ? 10 : 9}
                        className="text-center py-8 text-muted-foreground"
                      >
                        {loading ? tc("loading") : t("noProductData")}
                      </TableCell>
                    </TableRow>
                  ) : (
                    products.map((product) => (
                      <TableRow key={product.id}>
                        <TableCell className="w-12">
                          <input
                            type="checkbox"
                            checked={selectedProducts.includes(product.id)}
                            onChange={() => toggleProductSelection(product.id)}
                            className="rounded border-border"
                          />
                        </TableCell>
                        <TableCell className="font-mono">{product.sn}</TableCell>
                        <TableCell>{product.name}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{product.category}</Badge>
                        </TableCell>
                        <TableCell>{product.material}</TableCell>
                        <TableCell>{product.spec}</TableCell>
                        <TableCell>
                          <Badge
                            variant={getSegmentStatusDisplay(product.embedding_status).variant}
                            className={getSegmentStatusDisplay(product.embedding_status).className}
                          >
                            {getSegmentStatusDisplay(product.embedding_status).text}
                          </Badge>
                        </TableCell>
                        {searchType === "vector" && searchTerm && (
                          <TableCell>
                            {product.similarity !== undefined ? (
                              <Badge variant="outline" className="bg-primary/10 text-primary">
                                {(product.similarity * 100).toFixed(1)}%
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </TableCell>
                        )}
                        <TableCell>{new Date(product.created_at).toLocaleDateString()}</TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openEditDialog(product)}
                            >
                              <Edit className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => deleteProduct(product.id)}
                            >
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>

              {/* 分页 */}
              <Pagination
                pagination={pagination}
                onPageChange={(page) => setPagination((prev) => ({ ...prev, page }))}
                itemName={t("productUnit")}
              />
            </>
          )}
        </CardContent>
      </Card>

      {/* 新增产品对话框 */}
      <Sheet open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <SheetContent className="max-w-2xl">
          <SheetHeader>
            <SheetTitle>{t("addProduct")}</SheetTitle>
          </SheetHeader>
          <ProductForm
            formData={formData}
            setFormData={setFormData}
            onSave={saveProduct}
            onCancel={() => setIsAddDialogOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {/* 编辑产品对话框 */}
      <Sheet open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <SheetContent className="max-w-2xl">
          <SheetHeader>
            <SheetTitle>{t("editProduct")}</SheetTitle>
          </SheetHeader>
          <ProductForm
            formData={formData}
            setFormData={setFormData}
            onSave={saveProduct}
            onCancel={() => setIsEditDialogOpen(false)}
          />
        </SheetContent>
      </Sheet>

      {/* 批量导入对话框 */}
      <Sheet open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
        <SheetContent className="max-w-4xl">
          <SheetHeader>
            <SheetTitle>{t("batchImportProducts")}</SheetTitle>
          </SheetHeader>
          <Tabs defaultValue="upload" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="upload">{t("fileUpload")}</TabsTrigger>
              <TabsTrigger value="results">{t("importResults")}</TabsTrigger>
            </TabsList>

            <TabsContent value="upload" className="space-y-4">
              <div className="space-y-4">
                <div>
                  <Label htmlFor="file">{t("selectExcelFile")}</Label>
                  <Input
                    id="file"
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleFileChange}
                    className="mt-2"
                  />
                  <p className="text-sm text-muted-foreground mt-1">{t("supportedFormats")}</p>
                </div>

                <div className="space-y-2">
                  <h4 className="font-medium">{t("excelFormatRequirement")}</h4>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    <li>• {t("firstRowHeader")}</li>
                    <li>• {t("requiredFields")}</li>
                    <li>• {t("optionalFields")}</li>
                    <li>• {t("uniqueSn")}</li>
                  </ul>
                </div>

                <div className="flex gap-2">
                  <Button onClick={handleImport} disabled={!importFile || importing}>
                    {importing ? t("importing") : t("startImport")}
                  </Button>
                  <Button variant="outline" onClick={downloadTemplate}>
                    <FileSpreadsheet className="w-4 h-4 mr-2" />
                    {t("downloadTemplate")}
                  </Button>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="results">
              {importResults.length > 0 ? (
                <div className="space-y-4">
                  <h4 className="font-medium">{t("importResults")}</h4>
                  <div className="max-h-64 overflow-y-auto">
                    {importResults.map((result, index) => (
                      <div
                        key={index}
                        className={`p-3 rounded border ${
                          result.success
                            ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-900/20"
                            : "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20"
                        }`}
                      >
                        <div className="flex justify-between items-start">
                          <span className="font-medium">
                            {t("row")} {result.row}
                            {t("rowUnit")}: {result.success ? t("success") : t("failed")}
                          </span>
                        </div>
                        {result.success && result.data && (
                          <div className="text-sm text-green-700 dark:text-green-300 mt-1">
                            {t("productCreated", { name: result.data.name, sn: result.data.sn })}
                          </div>
                        )}
                        {!result.success && result.error && (
                          <div className="text-sm text-red-700 dark:text-red-300 mt-1">
                            {t("error")}: {result.error}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">{t("noImportResults")}</div>
              )}
            </TabsContent>
          </Tabs>
        </SheetContent>
      </Sheet>
    </div>
  );
}

// 产品表单组件
function ProductForm({
  formData,
  setFormData,
  onSave,
  onCancel,
}: {
  formData: any;
  setFormData: (data: any) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("products");
  const tc = useTranslations("common");
  const handleChange = (field: string, value: string) => {
    setFormData({ ...formData, [field]: value });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="sn">{t("productSnRequired")}</Label>
          <Input
            id="sn"
            value={formData.sn}
            onChange={(e) => handleChange("sn", e.target.value)}
            placeholder={t("snPlaceholder")}
            required
          />
        </div>
        <div>
          <Label htmlFor="name">{t("productNameRequired")}</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => handleChange("name", e.target.value)}
            placeholder={t("namePlaceholder")}
            required
          />
        </div>
      </div>

      <div>
        <Label htmlFor="category">{t("category")}</Label>
        <Input
          id="category"
          value={formData.category}
          onChange={(e) => handleChange("category", e.target.value)}
          placeholder={t("categoryExample")}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="material">{t("material")}</Label>
          <Input
            id="material"
            value={formData.material}
            onChange={(e) => handleChange("material", e.target.value)}
            placeholder={t("materialExample")}
          />
        </div>
        <div>
          <Label htmlFor="spec">{t("spec")}</Label>
          <Input
            id="spec"
            value={formData.spec}
            onChange={(e) => handleChange("spec", e.target.value)}
            placeholder={t("specExample")}
          />
        </div>
      </div>

      <div>
        <Label htmlFor="description">{t("description")}</Label>
        <Textarea
          id="description"
          value={formData.description}
          onChange={(e) => handleChange("description", e.target.value)}
          placeholder={t("descriptionPlaceholder")}
          rows={3}
        />
      </div>

      <div>
        <Label htmlFor="memo">{t("memo")}</Label>
        <Textarea
          id="memo"
          value={formData.memo}
          onChange={(e) => handleChange("memo", e.target.value)}
          placeholder={t("memoPlaceholder")}
          rows={2}
        />
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <Button variant="outline" onClick={onCancel}>
          {tc("cancel")}
        </Button>
        <Button onClick={onSave}>{tc("save")}</Button>
      </div>
    </div>
  );
}
