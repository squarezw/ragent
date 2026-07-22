"use client";
import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Edit,
  Trash2,
  Rocket,
  Plus,
  Pencil,
  ChevronLeft,
  ChevronRight,
  FileText,
  Image,
  Settings,
  AlertCircle,
} from "lucide-react";

import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import * as Dialog from "@radix-ui/react-dialog";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { checkSuperAdmin, checkTenantAdmin } from "@/lib/clientPermissions";
import axios from "@/lib/axios";
import { uploadFile } from "@/lib/ossUpload";
import { useTranslations } from "next-intl";

interface Category {
  id: number;
  name: string;
}
interface SubCategory {
  id: number;
  category_id: number;
  name: string;
  vector_status?: string;
  embedding_model?: string;
  type?: string;
}

interface SopDetail {
  id: number;
  subcategory_id: number;
  step_number: string;
  image_url: string | null;
  content: string;
  vector_status?: string;
}

export default function SopPage() {
  const t = useTranslations("sop");
  const tc = useTranslations("common");
  const { user, loading } = useCurrentUser();
  const isSuperAdmin = checkSuperAdmin(user);
  const isTenantAdmin = checkTenantAdmin(user);
  const isDeptAdmin = user?.isDeptAdmin || false;
  const canManageSOP = isSuperAdmin || isTenantAdmin || isDeptAdmin;

  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<SubCategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [newCategory, setNewCategory] = useState("");
  const [newSubCategory, setNewSubCategory] = useState("");
  const [newSubCategoryType, setNewSubCategoryType] = useState("process");
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [editingSubCategory, setEditingSubCategory] = useState<SubCategory | null>(null);
  const [editCategoryName, setEditCategoryName] = useState("");
  const [editSubCategoryName, setEditSubCategoryName] = useState("");
  const [editSubCategoryType, setEditSubCategoryType] = useState("process");
  const [selectedSubCategory, setSelectedSubCategory] = useState<SubCategory | null>(null);
  const [details, setDetails] = useState<SopDetail[]>([]);
  const [processDetails, setProcessDetails] = useState<SopDetail[]>([]);
  const [isoDetails, setIsoDetails] = useState<SopDetail[]>([]);
  const [newDetail, setNewDetail] = useState<{
    step_number: string;
    content: string;
    image: File | null;
  }>({ step_number: "", content: "", image: null });
  const [editingDetail, setEditingDetail] = useState<SopDetail | null>(null);
  const [editDetail, setEditDetail] = useState<{
    step_number: string;
    content: string;
    image: File | null;
  }>({ step_number: "", content: "", image: null });
  const [showAddDetailDialog, setShowAddDetailDialog] = useState(false);
  const [addDetailError, setAddDetailError] = useState("");
  const [isAddingDetail, setIsAddingDetail] = useState(false);
  const [showImagePreview, setShowImagePreview] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ url: string; alt: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const editFileInputRef = useRef<HTMLInputElement>(null);
  const [vectorizingId, setVectorizingId] = useState<number | null>(null);
  const [vectorizeProgress, setVectorizeProgress] = useState<{ [id: number]: number }>({});
  const [vectorizePolling, setVectorizePolling] = useState<{ [id: number]: boolean }>({});
  const [subcatVectorStatus, setSubcatVectorStatus] = useState<string>("pending");
  const [subcatVectorizing, setSubcatVectorizing] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // 加载行业大类
  const fetchCategories = async () => {
    const res = await axios.get("/api/sop/category");
    setCategories(res.data.categories || []);
    if (!selectedCategory && res.data.categories?.length > 0) {
      setSelectedCategory(res.data.categories[0]);
    }
  };
  // 加载小类
  const fetchSubCategories = async (categoryId: number) => {
    const res = await axios.get(`/api/sop/subcategory?category_id=${categoryId}`);
    setSubcategories(res.data.subcategories || []);
    // 自动同步当前选中子类的 vector_status
    if (selectedSubCategory) {
      const found = res.data.subcategories.find((s: any) => s.id === selectedSubCategory.id);
      if (found) setSubcatVectorStatus(found.vector_status || "pending");
    }
  };

  useEffect(() => {
    fetchCategories();
  }, []);
  useEffect(() => {
    if (selectedCategory) fetchSubCategories(selectedCategory.id);
  }, [selectedCategory]);

  // 轮询子类向量化状态
  useEffect(() => {
    if (!selectedSubCategory) return;
    const polling = true;
    const poll = async () => {
      const res = await axios.get(`/api/sop/subcategory?category_id=${selectedCategory?.id}`);
      const found = res.data.subcategories.find((s: any) => s.id === selectedSubCategory.id);
      if (found) setSubcatVectorStatus(found.vector_status || "pending");
      if (found && found.vector_status === "processing") {
        setTimeout(poll, 1000);
      } else {
        setSubcatVectorizing(false);
        fetchDetails(selectedSubCategory.id);
      }
    };
    if (subcatVectorizing) poll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subcatVectorizing, selectedSubCategory]);

  // 联动加载细项
  useEffect(() => {
    if (!selectedCategory) {
      setDetails([]);
      setProcessDetails([]);
      setIsoDetails([]);
      return;
    }
    if (!selectedSubCategory) {
      // 选中大类但未选子类，加载所有子类的 SOP 细项
      const loadAllDetails = async () => {
        let allDetails: SopDetail[] = [];
        let processDetailsList: SopDetail[] = [];
        let isoDetailsList: SopDetail[] = [];

        for (const sub of subcategories) {
          try {
            const res = await axios.get(`/api/sop/detail?subcategory_id=${sub.id}`);
            if (res.data.details) {
              allDetails = allDetails.concat(res.data.details);
              // 根据子类类型分类
              if (sub.type === "iso") {
                isoDetailsList = isoDetailsList.concat(res.data.details);
              } else {
                processDetailsList = processDetailsList.concat(res.data.details);
              }
            }
          } catch (error) {
            console.error("加载子类详情失败:", error);
          }
        }
        setDetails(allDetails);
        setProcessDetails(processDetailsList);
        setIsoDetails(isoDetailsList);
      };
      loadAllDetails();
    } else {
      fetchDetails(selectedSubCategory.id);
      // 如果选中了特定子类，根据其类型设置对应的详情
      if (selectedSubCategory.type === "iso") {
        setIsoDetails(details);
        setProcessDetails([]);
      } else {
        setProcessDetails(details);
        setIsoDetails([]);
      }
    }
  }, [selectedCategory, selectedSubCategory, subcategories]);

  const fetchDetails = async (subcategoryId: number) => {
    try {
      const res = await axios.get(`/api/sop/detail?subcategory_id=${subcategoryId}`);
      const detailsData = res.data.details || [];
      setDetails(detailsData);

      // 根据选中的子类类型更新对应的详情列表
      if (selectedSubCategory) {
        if (selectedSubCategory.type === "iso") {
          setIsoDetails(detailsData);
          setProcessDetails([]);
        } else {
          setProcessDetails(detailsData);
          setIsoDetails([]);
        }
      }
    } catch (error) {
      console.error("获取详情失败:", error);
      setDetails([]);
      setProcessDetails([]);
      setIsoDetails([]);
    }
  };

  // 新增行业大类
  const handleAddCategory = async () => {
    if (!newCategory.trim()) return;
    await axios.post("/api/sop/category", { name: newCategory });
    setNewCategory("");
    fetchCategories();
  };
  // 删除行业大类
  const handleDeleteCategory = async (id: number) => {
    await axios.delete("/api/sop/category", { data: { id } });
    if (selectedCategory?.id === id) setSelectedCategory(null);
    fetchCategories();
  };
  // 编辑行业大类
  const handleEditCategory = (cat: Category) => {
    setEditingCategory(cat);
    setEditCategoryName(cat.name);
  };
  const handleSaveEditCategory = async () => {
    if (!editingCategory) return;
    await axios.put("/api/sop/category", { id: editingCategory.id, name: editCategoryName });
    setEditingCategory(null);
    setEditCategoryName("");
    fetchCategories();
  };

  // 新增小类
  const handleAddSubCategory = async () => {
    if (!newSubCategory.trim() || !selectedCategory) return;
    await axios.post("/api/sop/subcategory", {
      category_id: selectedCategory.id,
      name: newSubCategory,
      type: newSubCategoryType,
    });
    setNewSubCategory("");
    setNewSubCategoryType("process");
    fetchSubCategories(selectedCategory.id);
  };
  // 删除小类
  const handleDeleteSubCategory = async (id: number) => {
    await axios.delete("/api/sop/subcategory", { data: { id } });
    fetchSubCategories(selectedCategory!.id);
  };
  // 编辑小类
  const handleEditSubCategory = (sub: SubCategory) => {
    setEditingSubCategory(sub);
    setEditSubCategoryName(sub.name);
    setEditSubCategoryType(sub.type || "process");
  };
  const handleSaveEditSubCategory = async () => {
    if (!editingSubCategory) return;
    await axios.put("/api/sop/subcategory", {
      id: editingSubCategory.id,
      name: editSubCategoryName,
      type: editSubCategoryType,
    });
    setEditingSubCategory(null);
    setEditSubCategoryName("");
    setEditSubCategoryType("process");
    fetchSubCategories(selectedCategory!.id);
  };

  // 新增细项
  const handleAddDetail = async () => {
    if (!selectedSubCategory || !newDetail.step_number.trim() || !newDetail.content.trim())
      return false;

    setIsAddingDetail(true);
    setAddDetailError("");

    try {
      let image_url = null;
      if (newDetail.image) {
        const objectKey = await uploadFile({ file: newDetail.image, category: "sop-images" });
        const res = await axios.post("/api/sop/upload-confirm", { objectKey });
        image_url = res.data.url ? res.data.url : null;
      }

      await axios.post("/api/sop/detail", {
        subcategory_id: selectedSubCategory.id,
        step_number: newDetail.step_number,
        image_url: image_url ?? null,
        content: newDetail.content,
      });

      setNewDetail({ step_number: "", content: "", image: null });
      if (fileInputRef.current) fileInputRef.current.value = "";
      fetchDetails(selectedSubCategory.id);
      // 重新加载子类数据以更新类型信息
      fetchSubCategories(selectedCategory?.id || 0);
      return true; // 返回成功状态
    } catch (error: any) {
      console.error("添加详情失败:", error);
      setAddDetailError(error.response?.data?.error || "添加失败，请重试");
      return false;
    } finally {
      setIsAddingDetail(false);
    }
  };
  // 删除细项
  const handleDeleteDetail = async (id: number) => {
    await axios.delete("/api/sop/detail", { data: { id } });
    if (selectedSubCategory) fetchDetails(selectedSubCategory.id);
    // 重新加载子类数据以更新类型信息
    fetchSubCategories(selectedCategory?.id || 0);
  };
  // 编辑细项
  const handleEditDetail = (detail: SopDetail) => {
    setEditingDetail(detail);
    setEditDetail({ step_number: detail.step_number, content: detail.content, image: null });
  };
  const handleSaveEditDetail = async () => {
    if (!editingDetail || !editDetail.step_number.trim() || !editDetail.content.trim()) return;
    let image_url = editingDetail.image_url;
    if (editDetail.image) {
      const objectKey = await uploadFile({ file: editDetail.image, category: "sop-images" });
      const res = await axios.post("/api/sop/upload-confirm", { objectKey });
      image_url = res.data.url ? res.data.url : null;
    }
    await axios.put("/api/sop/detail", {
      id: editingDetail.id,
      step_number: editDetail.step_number,
      image_url: image_url ?? null,
      content: editDetail.content,
    });
    setEditingDetail(null);
    setEditDetail({ step_number: "", content: "", image: null });
    if (editFileInputRef.current) editFileInputRef.current.value = "";
    if (selectedSubCategory) fetchDetails(selectedSubCategory.id);
    // 重新加载子类数据以更新类型信息
    fetchSubCategories(selectedCategory?.id || 0);
  };

  // 向量化操作
  const handleVectorize = async (id: number) => {
    setVectorizingId(id);
    setVectorizePolling((prev) => ({ ...prev, [id]: true }));
    const res = await axios.post(`/api/sop/vectorize?id=${id}`);
    if (res.data.status === "pending" || res.data.status === "processing") {
      let polling = true;
      const poll = async () => {
        const statusRes = await axios.get(`/api/sop/vector_status?id=${id}`);
        setVectorizeProgress((prev) => ({ ...prev, [id]: statusRes.data.progress }));
        if (statusRes.data.status === "indexed") {
          setVectorizingId(null);
          setVectorizePolling((prev) => ({ ...prev, [id]: false }));
          fetchDetails(selectedSubCategory?.id ?? 0);
          polling = false;
          return;
        }
        if (polling) setTimeout(poll, 1000);
      };
      poll();
    } else {
      setVectorizingId(null);
      fetchDetails(selectedSubCategory?.id ?? 0);
    }
  };

  // 滚动控制
  const scrollLeft = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: -300, behavior: "smooth" });
    }
  };

  const scrollRight = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollBy({ left: 300, behavior: "smooth" });
    }
  };

  // 处理图片点击放大
  const handleImageClick = (imageUrl: string, alt: string) => {
    setPreviewImage({ url: imageUrl, alt });
    setShowImagePreview(true);
  };

  return (
    <div className="flex flex-col gap-6 py-8 min-w-0 overflow-hidden">
      {/* 顶部下拉联动选择 */}
      <div className="flex gap-4 items-center">
        <Label>{t("industryCategory")}</Label>
        <select
          className="border rounded px-2 py-1"
          value={selectedCategory?.id || ""}
          onChange={(e) => {
            const cat = categories.find((c) => c.id === Number(e.target.value));
            setSelectedCategory(cat || null);
            setSelectedSubCategory(null);
          }}
        >
          <option value="">{t("pleaseSelect")}</option>
          {categories.map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name}
            </option>
          ))}
        </select>
        {canManageSOP && (
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setEditingCategory({ id: 0, name: "" })}
          >
            <Plus className="h-5 w-5 text-primary" />
          </Button>
        )}
        {/* 新增/编辑大类 Dialog */}
        <Dialog.Root open={!!editingCategory} onOpenChange={(v) => !v && setEditingCategory(null)}>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg bg-background p-6 shadow-lg border flex flex-col gap-4">
              <Dialog.Title className="text-lg font-bold">
                {editingCategory?.id ? t("editCategory") : t("newCategory")}
              </Dialog.Title>
              <input
                className="border rounded px-3 py-2"
                placeholder={t("categoryNamePlaceholder")}
                value={editCategoryName}
                onChange={(e) => setEditCategoryName(e.target.value)}
                autoFocus
              />
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setEditingCategory(null)}>
                  {tc("cancel")}
                </Button>
                <Button
                  onClick={async () => {
                    if (!editCategoryName.trim()) return;
                    if (editingCategory?.id) {
                      await axios.put("/api/sop/category", {
                        id: editingCategory.id,
                        name: editCategoryName,
                      });
                    } else {
                      await axios.post("/api/sop/category", { name: editCategoryName });
                    }
                    setEditingCategory(null);
                    setEditCategoryName("");
                    fetchCategories();
                  }}
                  disabled={!editCategoryName.trim()}
                >
                  {tc("confirm")}
                </Button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
        <Label className="ml-6">{t("sopSubCategory")}</Label>
        <div className="flex-1">
          <Tabs
            value={selectedSubCategory?.id ? String(selectedSubCategory.id) : ""}
            onValueChange={(v) => {
              if (v === "__add__") {
                setEditingSubCategory({ id: 0, category_id: selectedCategory?.id || 0, name: "" });
                return;
              }
              setSelectedSubCategory(subcategories.find((s) => String(s.id) === v) || null);
            }}
          >
            <TabsList className="overflow-x-auto whitespace-nowrap">
              <TabsTrigger value="" className="min-w-[80px]">
                {t("all")}
              </TabsTrigger>
              {subcategories.map((sub) => (
                <TabsTrigger key={sub.id} value={String(sub.id)} className="min-w-[80px]">
                  <div className="flex flex-col items-center">
                    <span>{sub.name}</span>
                  </div>
                </TabsTrigger>
              ))}
              {canManageSOP &&
                (selectedSubCategory ? (
                  <TabsTrigger
                    value={selectedSubCategory.id ? String(selectedSubCategory.id) : ""}
                    className="min-w-[60px] text-blue-700 flex items-center justify-center"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setEditingSubCategory(selectedSubCategory);
                      setEditSubCategoryName(selectedSubCategory.name);
                    }}
                    tabIndex={-1}
                    style={{ pointerEvents: "auto" }}
                  >
                    <Pencil className="h-5 w-5" />
                  </TabsTrigger>
                ) : (
                  <TabsTrigger
                    value="__add__"
                    className="min-w-[60px] text-blue-700 flex items-center justify-center"
                  >
                    <Plus className="h-5 w-5" />
                  </TabsTrigger>
                ))}
            </TabsList>
          </Tabs>
        </div>
        {/* 新增/编辑小类 Dialog */}
        <Dialog.Root
          open={!!editingSubCategory}
          onOpenChange={(v) => !v && setEditingSubCategory(null)}
        >
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-lg bg-background p-6 shadow-lg border flex flex-col gap-4">
              <Dialog.Title className="text-lg font-bold">
                {editingSubCategory?.id ? t("editSubCategory") : t("newSubCategory")}
              </Dialog.Title>
              <input
                className="border rounded px-3 py-2"
                placeholder={t("subCategoryNamePlaceholder")}
                value={editSubCategoryName}
                onChange={(e) => setEditSubCategoryName(e.target.value)}
                autoFocus
              />
              <select
                className="border rounded px-3 py-2"
                value={editSubCategoryType}
                onChange={(e) => setEditSubCategoryType(e.target.value)}
              >
                <option value="process">{t("process")}</option>
                <option value="iso">{t("standard")}</option>
              </select>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setEditingSubCategory(null)}>
                  {tc("cancel")}
                </Button>
                <Button
                  onClick={async () => {
                    if (!editSubCategoryName.trim()) return;
                    if (editingSubCategory?.id) {
                      await axios.put("/api/sop/subcategory", {
                        id: editingSubCategory.id,
                        name: editSubCategoryName,
                        type: editSubCategoryType,
                      });
                    } else {
                      await axios.post("/api/sop/subcategory", {
                        category_id: selectedCategory?.id,
                        name: editSubCategoryName,
                        type: editSubCategoryType,
                      });
                    }
                    setEditingSubCategory(null);
                    setEditSubCategoryName("");
                    setEditSubCategoryType("process");
                    fetchSubCategories(selectedCategory?.id || 0);
                  }}
                  disabled={!editSubCategoryName.trim()}
                >
                  {tc("confirm")}
                </Button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </div>

      {/* 上半部分：图片横排+文字+icon，可左右滑动 */}
      <Card className="mb-6 overflow-hidden">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              {t("workflowProcess")}
            </CardTitle>
            <div className="flex items-center gap-2">
              {selectedSubCategory && selectedSubCategory.type === "process" && canManageSOP && (
                <Button size="sm" variant="outline" onClick={() => setShowAddDetailDialog(true)}>
                  <Plus className="h-4 w-4 mr-1" />
                  {t("addProcess")}
                </Button>
              )}
              {selectedSubCategory && canManageSOP && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={subcatVectorStatus === "processing" || subcatVectorizing}
                  onClick={async () => {
                    setSubcatVectorizing(true);
                    await axios.post("/api/sop/subcategory_vectorize", {
                      subcategory_id: selectedSubCategory.id,
                    });
                  }}
                >
                  <Rocket className="h-4 w-4 mr-1" />
                  {subcatVectorStatus === "processing" || subcatVectorizing
                    ? t("vectorizing")
                    : t("vectorize")}
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {details.length > 0 ? (
            <div className="relative overflow-hidden w-full">
              {/* 滚动按钮 */}
              <Button
                size="icon"
                variant="outline"
                className="absolute left-2 top-1/2 -translate-y-1/2 z-10 bg-white/80 hover:bg-white shadow-md"
                onClick={scrollLeft}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="outline"
                className="absolute right-2 top-1/2 -translate-y-1/2 z-10 bg-white/80 hover:bg-white shadow-md"
                onClick={scrollRight}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>

              {/* 可滑动的工序卡片容器 */}
              <div
                ref={scrollContainerRef}
                className="flex gap-4 overflow-x-auto scrollbar-hide pb-4 px-2 min-w-0 max-w-full"
                style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
              >
                {processDetails.map((detail, index) => (
                  <div
                    key={detail.id}
                    className="flex-shrink-0 w-80 bg-white border rounded-lg shadow-sm hover:shadow-md transition-shadow"
                  >
                    {/* 编辑模式 */}
                    {editingDetail && editingDetail.id === detail.id ? (
                      <div className="p-4 space-y-4">
                        <div className="flex items-center justify-between">
                          <Input
                            value={editDetail.step_number}
                            onChange={(e) =>
                              setEditDetail((d) => ({ ...d, step_number: e.target.value }))
                            }
                            type="text"
                            className="w-32 font-semibold text-lg"
                            placeholder={t("processNumberPlaceholder")}
                          />
                          <div className="flex gap-2">
                            <Button size="sm" onClick={handleSaveEditDetail}>
                              {tc("save")}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setEditingDetail(null)}
                            >
                              {tc("cancel")}
                            </Button>
                          </div>
                        </div>

                        <div>
                          <textarea
                            value={editDetail.content}
                            onChange={(e) =>
                              setEditDetail((d) => ({ ...d, content: e.target.value }))
                            }
                            className="w-full min-h-[100px] border rounded px-3 py-2 resize-vertical"
                            placeholder={t("contentPlaceholder")}
                          />
                        </div>

                        <div>
                          <input
                            type="file"
                            accept="image/*"
                            ref={editFileInputRef}
                            onChange={(e) =>
                              setEditDetail((d) => ({ ...d, image: e.target.files?.[0] || null }))
                            }
                            className="w-full"
                          />
                          {editingDetail.image_url && (
                            <img
                              src={editingDetail.image_url}
                              alt={t("schematicDiagram")}
                              className="w-full h-48 object-contain mt-2 rounded border cursor-pointer hover:opacity-90 transition-opacity"
                              onClick={() =>
                                handleImageClick(
                                  editingDetail.image_url!,
                                  t("editProcess", { number: detail.step_number })
                                )
                              }
                            />
                          )}
                        </div>

                        <div className="flex items-center justify-between">
                          <span
                            className={
                              editingDetail.vector_status === "indexed"
                                ? "text-green-600 font-bold"
                                : editingDetail.vector_status === "processing"
                                  ? "text-yellow-600 font-bold"
                                  : editingDetail.vector_status === "failed"
                                    ? "text-red-600 font-bold"
                                    : "text-gray-400"
                            }
                          >
                            {editingDetail.vector_status === "indexed"
                              ? t("indexed")
                              : editingDetail.vector_status === "processing"
                                ? t("processing")
                                : editingDetail.vector_status === "failed"
                                  ? t("failed")
                                  : t("notVectorized")}
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleVectorize(detail.id)}
                            disabled={editingDetail.vector_status === "processing"}
                          >
                            <Rocket className="h-4 w-4 mr-1" />
                            {t("vectorize")}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      /* 显示模式 */
                      <>
                        {/* 图片区域 */}
                        <div className="h-48 bg-gray-100 rounded-t-lg overflow-hidden flex items-center justify-center">
                          {detail.image_url ? (
                            <img
                              src={detail.image_url}
                              alt={t("processLabel", { number: detail.step_number })}
                              className="w-full h-full object-cover cursor-pointer hover:opacity-90 transition-opacity"
                              onClick={() =>
                                handleImageClick(
                                  detail.image_url!,
                                  t("processLabel", { number: detail.step_number })
                                )
                              }
                            />
                          ) : (
                            <div className="flex flex-col items-center justify-center text-gray-400">
                              <Image className="h-12 w-12 mb-2" />
                              <span className="text-sm">{t("noImage")}</span>
                            </div>
                          )}
                        </div>

                        {/* 内容区域 */}
                        <div className="p-4">
                          <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                                <span className="text-blue-600 font-semibold text-sm">
                                  {detail.step_number}
                                </span>
                              </div>
                              <span className="font-medium text-gray-900">
                                {t("processLabel", { number: detail.step_number })}
                              </span>
                            </div>
                            <div className="flex items-center gap-1">
                              {detail.vector_status === "indexed" && (
                                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                              )}
                              {detail.vector_status === "processing" && (
                                <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></div>
                              )}
                              {detail.vector_status === "failed" && (
                                <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                              )}
                            </div>
                          </div>

                          <div className="text-gray-600 text-sm leading-relaxed mb-3 line-clamp-3">
                            {detail.content}
                          </div>

                          {/* 操作按钮 */}
                          {canManageSOP && (
                            <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                              <div className="flex gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleEditDetail(detail)}
                                  className="h-8 px-2"
                                >
                                  <Edit className="h-3 w-3" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleDeleteDetail(detail.id)}
                                  className="h-8 px-2 text-red-500 hover:text-red-700"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                              <div className="text-xs text-gray-400">
                                {detail.vector_status === "indexed"
                                  ? t("ready")
                                  : detail.vector_status === "processing"
                                    ? t("processing")
                                    : detail.vector_status === "failed"
                                      ? t("failed")
                                      : t("notVectorized")}
                              </div>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>{t("noProcessData")}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 下半部分：工艺图纸 */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              {t("craftStandard")}
            </CardTitle>
            {selectedSubCategory && selectedSubCategory.type === "iso" && canManageSOP && (
              <Button size="sm" variant="outline" onClick={() => setShowAddDetailDialog(true)}>
                <Plus className="h-4 w-4 mr-1" />
                {t("addStandard")}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isoDetails.length > 0 ? (
            <div className="grid grid-cols-2 gap-6">
              {isoDetails.map((detail) => (
                <div key={detail.id} className="bg-white border rounded-lg p-4 shadow-sm">
                  {/* 编辑模式 */}
                  {editingDetail && editingDetail.id === detail.id ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <Input
                          value={editDetail.step_number}
                          onChange={(e) =>
                            setEditDetail((d) => ({ ...d, step_number: e.target.value }))
                          }
                          type="text"
                          className="w-32 font-semibold text-lg"
                          placeholder={t("processNumberPlaceholder")}
                        />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={handleSaveEditDetail}>
                            {tc("save")}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setEditingDetail(null)}
                          >
                            {tc("cancel")}
                          </Button>
                        </div>
                      </div>

                      <div>
                        <textarea
                          value={editDetail.content}
                          onChange={(e) =>
                            setEditDetail((d) => ({ ...d, content: e.target.value }))
                          }
                          className="w-full min-h-[100px] border rounded px-3 py-2 resize-vertical"
                          placeholder={t("contentPlaceholder")}
                        />
                      </div>

                      <div>
                        <input
                          type="file"
                          accept="image/*"
                          ref={editFileInputRef}
                          onChange={(e) =>
                            setEditDetail((d) => ({ ...d, image: e.target.files?.[0] || null }))
                          }
                          className="w-full"
                        />
                        {editingDetail.image_url && (
                          <img
                            src={editingDetail.image_url}
                            alt={t("schematicDiagram")}
                            className="w-full h-48 object-contain mt-2 rounded border cursor-pointer hover:opacity-90 transition-opacity"
                            onClick={() =>
                              handleImageClick(
                                editingDetail.image_url!,
                                t("editProcess", { number: detail.step_number })
                              )
                            }
                          />
                        )}
                      </div>

                      <div className="flex items-center justify-between">
                        <span
                          className={
                            editingDetail.vector_status === "indexed"
                              ? "text-green-600 font-bold"
                              : editingDetail.vector_status === "processing"
                                ? "text-yellow-600 font-bold"
                                : editingDetail.vector_status === "failed"
                                  ? "text-red-600 font-bold"
                                  : "text-gray-400"
                          }
                        >
                          {editingDetail.vector_status === "indexed"
                            ? t("ready")
                            : editingDetail.vector_status === "processing"
                              ? t("processing")
                              : editingDetail.vector_status === "failed"
                                ? t("failed")
                                : t("notVectorized")}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleVectorize(detail.id)}
                          disabled={editingDetail.vector_status === "processing"}
                        >
                          <Rocket className="h-4 w-4 mr-1" />
                          {t("vectorize")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    /* 显示模式 */
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h3 className="font-semibold text-lg text-gray-800">
                          {detail.step_number}
                        </h3>
                        {canManageSOP && (
                          <div className="flex gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleEditDetail(detail)}
                              aria-label={tc("edit")}
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => handleDeleteDetail(detail.id)}
                              aria-label={tc("delete")}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </div>

                      {detail.image_url && (
                        <div className="relative">
                          <img
                            src={detail.image_url}
                            alt={t("schematicDiagram")}
                            className="w-full h-48 object-contain rounded border bg-gray-50 cursor-pointer hover:opacity-90 transition-opacity"
                            onClick={() =>
                              handleImageClick(
                                detail.image_url!,
                                t("standardLabel", { number: detail.step_number })
                              )
                            }
                          />
                        </div>
                      )}

                      <div className="text-gray-700 whitespace-pre-line line-clamp-3">
                        {detail.content}
                      </div>

                      <div className="flex items-center justify-between">
                        <span
                          className={
                            detail.vector_status === "indexed"
                              ? "text-green-600 font-bold"
                              : detail.vector_status === "processing"
                                ? "text-yellow-600 font-bold"
                                : detail.vector_status === "failed"
                                  ? "text-red-600 font-bold"
                                  : "text-gray-400"
                          }
                        >
                          {detail.vector_status === "indexed"
                            ? t("ready")
                            : detail.vector_status === "processing"
                              ? t("processing")
                              : detail.vector_status === "failed"
                                ? t("failed")
                                : t("notVectorized")}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleVectorize(detail.id)}
                          disabled={detail.vector_status === "processing"}
                        >
                          <Rocket className="h-4 w-4 mr-1" />
                          {t("vectorize")}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <Settings className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>{t("noDocument")}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 添加详情对话框 */}
      <Dialog.Root open={showAddDetailDialog} onOpenChange={setShowAddDetailDialog}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/30 z-50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-lg flex flex-col gap-4">
            <Dialog.Title className="text-lg font-bold">
              {selectedSubCategory?.type === "iso" ? t("addStandardDoc") : t("addProcess")}
            </Dialog.Title>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="step-number">{t("processNumber")}</Label>
                <Input
                  id="step-number"
                  value={newDetail.step_number}
                  onChange={(e) => setNewDetail((d) => ({ ...d, step_number: e.target.value }))}
                  placeholder={t("processNumberPlaceholder")}
                  className="mt-1"
                />
              </div>

              <div>
                <Label htmlFor="image-upload">{t("schematicDiagram")}</Label>
                <Input
                  id="image-upload"
                  type="file"
                  accept="image/*"
                  ref={fileInputRef}
                  onChange={(e) =>
                    setNewDetail((d) => ({ ...d, image: e.target.files?.[0] || null }))
                  }
                  className="mt-1"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="content">{t("contentDescription")}</Label>
              <textarea
                id="content"
                value={newDetail.content}
                onChange={(e) => setNewDetail((d) => ({ ...d, content: e.target.value }))}
                placeholder={t("contentPlaceholder")}
                className="mt-1 w-full min-h-[120px] border rounded px-3 py-2 resize-vertical"
              />
            </div>

            {addDetailError && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-md text-red-700">
                <AlertCircle className="h-4 w-4" />
                <span className="text-sm">{addDetailError}</span>
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setShowAddDetailDialog(false);
                  setNewDetail({ step_number: "", content: "", image: null });
                  setAddDetailError("");
                  if (fileInputRef.current) fileInputRef.current.value = "";
                }}
                disabled={isAddingDetail}
              >
                {tc("cancel")}
              </Button>
              <Button
                onClick={async () => {
                  if (!newDetail.step_number.trim() || !newDetail.content.trim()) {
                    setAddDetailError(t("fillProcessAndContent"));
                    return;
                  }
                  const success = await handleAddDetail();
                  if (success) {
                    setShowAddDetailDialog(false);
                    setNewDetail({ step_number: "", content: "", image: null });
                    setAddDetailError("");
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }
                }}
                disabled={
                  !newDetail.step_number.trim() || !newDetail.content.trim() || isAddingDetail
                }
              >
                {isAddingDetail ? t("adding") : t("confirmAdd")}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* 图片预览对话框 */}
      <Dialog.Root open={showImagePreview} onOpenChange={setShowImagePreview}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-4xl -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white p-6 shadow-lg flex flex-col gap-4">
            <Dialog.Title className="text-lg font-bold flex items-center justify-between">
              <span>{previewImage?.alt || t("imagePreview")}</span>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => setShowImagePreview(false)}
                className="h-8 w-8"
              >
                <span className="sr-only">{tc("close")}</span>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </Button>
            </Dialog.Title>

            {previewImage && (
              <div className="flex justify-center">
                <img
                  src={previewImage.url}
                  alt={previewImage.alt}
                  className="max-w-full max-h-[70vh] object-contain rounded border"
                />
              </div>
            )}

            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setShowImagePreview(false)}>
                {tc("close")}
              </Button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
