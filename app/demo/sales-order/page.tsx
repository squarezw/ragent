"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Calendar, Search, User, Package, Truck, Building2 } from "lucide-react";
import { useTranslations } from "next-intl";

interface OrderItem {
  id: number;
  productName: string;
  productCode: string;
  quantity: string;
  unitPrice: string;
  totalPrice: string;
}

export default function SalesOrderPage() {
  const t = useTranslations("salesOrder");
  const tc = useTranslations("common");

  // Helper function to get payment terms display text
  const getPaymentTermsText = (value: string) => {
    const map: Record<string, string> = {
      cashOnDelivery: t("paymentTermsCashOnDelivery"),
      prepayment: t("paymentTermsPrepayment"),
      monthly: t("paymentTermsMonthly"),
      bankTransfer: t("paymentTermsBankTransfer"),
      check: t("paymentTermsCheck"),
    };
    return map[value] || value;
  };

  // Helper function to get shipping method display text
  const getShippingMethodText = (value: string) => {
    const map: Record<string, string> = {
      express: t("shippingMethodExpress"),
      logistics: t("shippingMethodLogistics"),
      pickup: t("shippingMethodPickup"),
      dedicated: t("shippingMethodDedicated"),
    };
    return map[value] || value;
  };

  const [formData, setFormData] = useState({
    // 订单基本信息
    orderNumber: "",
    orderDate: "",
    deliveryDate: "",
    paymentTerms: "cashOnDelivery",
    currency: "CNY",

    // 客户信息
    customerName: "",
    customerCode: "",
    customerContact: "",
    customerPhone: "",
    customerEmail: "",
    customerAddress: "",

    // 配送信息
    shippingAddress: "",
    shippingMethod: "express",
    shippingContact: "",
    shippingPhone: "",

    // 订单金额
    subtotal: "0.00",
    taxRate: "13",
    taxAmount: "0.00",
    discount: "0.00",
    totalAmount: "0.00",
  });

  const [orderItems, setOrderItems] = useState<OrderItem[]>([
    {
      id: 1,
      productName: "",
      productCode: "",
      quantity: "",
      unitPrice: "",
      totalPrice: "",
    },
  ]);

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleItemChange = (id: number, field: keyof OrderItem, value: string) => {
    setOrderItems((prev) =>
      prev.map((item) => {
        if (item.id === id) {
          const updated = { ...item, [field]: value };
          // 自动计算总价
          if (field === "quantity" || field === "unitPrice") {
            const qty = parseFloat(updated.quantity) || 0;
            const price = parseFloat(updated.unitPrice) || 0;
            updated.totalPrice = (qty * price).toFixed(2);
          }
          return updated;
        }
        return item;
      })
    );
  };

  const addOrderItem = () => {
    setOrderItems((prev) => [
      ...prev,
      {
        id: prev.length + 1,
        productName: "",
        productCode: "",
        quantity: "",
        unitPrice: "",
        totalPrice: "",
      },
    ]);
  };

  const removeOrderItem = (id: number) => {
    setOrderItems((prev) => prev.filter((item) => item.id !== id));
  };

  // 自动计算订单总金额
  useEffect(() => {
    const subtotal = orderItems.reduce((sum, item) => {
      return sum + (parseFloat(item.totalPrice) || 0);
    }, 0);

    const taxRate = parseFloat(formData.taxRate) || 0;
    const taxAmount = subtotal * (taxRate / 100);
    const discount = parseFloat(formData.discount) || 0;
    const totalAmount = subtotal + taxAmount - discount;

    setFormData((prev) => ({
      ...prev,
      subtotal: subtotal.toFixed(2),
      taxAmount: taxAmount.toFixed(2),
      totalAmount: totalAmount.toFixed(2),
    }));
  }, [orderItems, formData.taxRate, formData.discount]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log("表单提交:", { formData, orderItems });
    alert(t("formSubmitted"));
  };

  return (
    <div className="bg-background">
      <div className="max-w-5xl mx-auto">
        {/* 头部 */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center space-x-4">
            <div className="bg-primary text-primary-foreground px-4 py-2 rounded">
              <div className="font-bold text-lg">COMPANY</div>
              <div className="text-xs">All that counts.</div>
            </div>
          </div>
          <h1 className="text-3xl font-bold text-center flex-1">{t("title")}</h1>
          <div></div>
        </div>

        {/* 公司信息 */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">{t("companyName")}</Label>
                <div className="text-sm text-muted-foreground mt-1">{t("companyNameExample")}</div>
              </div>
              <div>
                <Label className="text-sm font-medium">{t("companyCode")}</Label>
                <div className="text-sm text-muted-foreground mt-1">{t("companyCodeExample")}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* 订单基本信息 */}
          <Card>
            <CardHeader className="bg-primary/10 border-b">
              <CardTitle className="text-lg text-primary">{t("orderBasicInfo")}</CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <Label htmlFor="orderNumber" className="text-sm font-medium">
                      {t("orderNumber")}
                    </Label>
                    <Input
                      id="orderNumber"
                      value={formData.orderNumber}
                      onChange={(e) => handleInputChange("orderNumber", e.target.value)}
                      placeholder={t("enterOrderNumber")}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="orderDate" className="text-sm font-medium">
                      {t("orderDate")}
                    </Label>
                    <div className="flex items-center space-x-2 mt-1">
                      <Input
                        id="orderDate"
                        type="datetime-local"
                        value={formData.orderDate}
                        onChange={(e) => handleInputChange("orderDate", e.target.value)}
                      />
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-6">
                  <div>
                    <Label htmlFor="deliveryDate" className="text-sm font-medium">
                      {t("deliveryDate")}
                    </Label>
                    <div className="flex items-center space-x-2 mt-1">
                      <Input
                        id="deliveryDate"
                        type="date"
                        value={formData.deliveryDate}
                        onChange={(e) => handleInputChange("deliveryDate", e.target.value)}
                      />
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="paymentTerms" className="text-sm font-medium">
                      {t("paymentTerms")}
                    </Label>
                    <Select
                      value={formData.paymentTerms}
                      onValueChange={(value) => handleInputChange("paymentTerms", value)}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue>{getPaymentTermsText(formData.paymentTerms)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cashOnDelivery">
                          {t("paymentTermsCashOnDelivery")}
                        </SelectItem>
                        <SelectItem value="prepayment">{t("paymentTermsPrepayment")}</SelectItem>
                        <SelectItem value="monthly">{t("paymentTermsMonthly")}</SelectItem>
                        <SelectItem value="bankTransfer">
                          {t("paymentTermsBankTransfer")}
                        </SelectItem>
                        <SelectItem value="check">{t("paymentTermsCheck")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="currency" className="text-sm font-medium">
                      {t("currency")}
                    </Label>
                    <Select
                      value={formData.currency}
                      onValueChange={(value) => handleInputChange("currency", value)}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="CNY">{t("currencyCNY")}</SelectItem>
                        <SelectItem value="USD">{t("currencyUSD")}</SelectItem>
                        <SelectItem value="EUR">{t("currencyEUR")}</SelectItem>
                        <SelectItem value="JPY">{t("currencyJPY")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 客户信息 */}
          <Card>
            <CardHeader className="bg-primary/10 border-b">
              <CardTitle className="text-lg text-primary">{t("customerInfo")}</CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <Label htmlFor="customerName" className="text-sm font-medium">
                      {t("customerName")}
                    </Label>
                    <div className="flex items-center space-x-2 mt-1">
                      <Input
                        id="customerName"
                        value={formData.customerName}
                        onChange={(e) => handleInputChange("customerName", e.target.value)}
                        placeholder={t("enterCustomerName")}
                        className="flex-1"
                      />
                      <Search className="h-4 w-4 text-muted-foreground" />
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="customerCode" className="text-sm font-medium">
                      {t("customerCode")}
                    </Label>
                    <Input
                      id="customerCode"
                      value={formData.customerCode}
                      onChange={(e) => handleInputChange("customerCode", e.target.value)}
                      placeholder={t("enterCustomerCode")}
                      className="mt-1"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <Label htmlFor="customerContact" className="text-sm font-medium">
                      {t("contact")}
                    </Label>
                    <div className="flex items-center space-x-2 mt-1">
                      <Input
                        id="customerContact"
                        value={formData.customerContact}
                        onChange={(e) => handleInputChange("customerContact", e.target.value)}
                        placeholder={t("enterContact")}
                        className="flex-1"
                      />
                      <User className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="customerPhone" className="text-sm font-medium">
                      {t("phone")}
                    </Label>
                    <Input
                      id="customerPhone"
                      value={formData.customerPhone}
                      onChange={(e) => handleInputChange("customerPhone", e.target.value)}
                      placeholder={t("enterPhone")}
                      className="mt-1"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <Label htmlFor="customerEmail" className="text-sm font-medium">
                      {t("email")}
                    </Label>
                    <Input
                      id="customerEmail"
                      type="email"
                      value={formData.customerEmail}
                      onChange={(e) => handleInputChange("customerEmail", e.target.value)}
                      placeholder={t("enterEmail")}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="customerAddress" className="text-sm font-medium">
                      {t("customerAddress")}
                    </Label>
                    <Input
                      id="customerAddress"
                      value={formData.customerAddress}
                      onChange={(e) => handleInputChange("customerAddress", e.target.value)}
                      placeholder={t("enterCustomerAddress")}
                      className="mt-1"
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 产品信息 */}
          <Card>
            <CardHeader className="bg-primary/10 border-b">
              <CardTitle className="text-lg text-primary">{t("productInfo")}</CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="space-y-4">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left p-2 text-sm font-medium">{t("productName")}</th>
                        <th className="text-left p-2 text-sm font-medium">{t("productCode")}</th>
                        <th className="text-left p-2 text-sm font-medium">{t("quantity")}</th>
                        <th className="text-left p-2 text-sm font-medium">{t("unitPrice")}</th>
                        <th className="text-left p-2 text-sm font-medium">{t("totalPrice")}</th>
                        <th className="text-left p-2 text-sm font-medium">{t("actions")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orderItems.map((item) => (
                        <tr key={item.id} className="border-b">
                          <td className="p-2">
                            <Input
                              value={item.productName}
                              onChange={(e) =>
                                handleItemChange(item.id, "productName", e.target.value)
                              }
                              placeholder={t("enterProductName")}
                              className="w-full"
                            />
                          </td>
                          <td className="p-2">
                            <Input
                              value={item.productCode}
                              onChange={(e) =>
                                handleItemChange(item.id, "productCode", e.target.value)
                              }
                              placeholder={t("enterProductCode")}
                              className="w-full"
                            />
                          </td>
                          <td className="p-2">
                            <Input
                              type="number"
                              value={item.quantity}
                              onChange={(e) =>
                                handleItemChange(item.id, "quantity", e.target.value)
                              }
                              placeholder="0"
                              className="w-full"
                              step="0.01"
                            />
                          </td>
                          <td className="p-2">
                            <div className="flex items-center space-x-1">
                              <span className="text-sm text-muted-foreground">
                                {formData.currency === "CNY" ? "¥" : "$"}
                              </span>
                              <Input
                                type="number"
                                value={item.unitPrice}
                                onChange={(e) =>
                                  handleItemChange(item.id, "unitPrice", e.target.value)
                                }
                                placeholder="0.00"
                                className="flex-1"
                                step="0.01"
                              />
                            </div>
                          </td>
                          <td className="p-2">
                            <div className="flex items-center space-x-1">
                              <span className="text-sm text-muted-foreground">
                                {formData.currency === "CNY" ? "¥" : "$"}
                              </span>
                              <Input value={item.totalPrice} readOnly className="flex-1 bg-muted" />
                            </div>
                          </td>
                          <td className="p-2">
                            {orderItems.length > 1 && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => removeOrderItem(item.id)}
                                className="text-destructive"
                              >
                                {t("remove")}
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Button type="button" variant="outline" onClick={addOrderItem} className="w-full">
                  <Package className="h-4 w-4 mr-2" />
                  {t("addProduct")}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* 配送信息 */}
          <Card>
            <CardHeader className="bg-primary/10 border-b">
              <CardTitle className="text-lg text-primary">{t("shippingInfo")}</CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="space-y-6">
                <div>
                  <Label htmlFor="shippingAddress" className="text-sm font-medium">
                    {t("shippingAddress")}
                  </Label>
                  <div className="flex items-center space-x-2 mt-1">
                    <Input
                      id="shippingAddress"
                      value={formData.shippingAddress}
                      onChange={(e) => handleInputChange("shippingAddress", e.target.value)}
                      placeholder={t("enterShippingAddress")}
                      className="flex-1"
                    />
                    <Truck className="h-4 w-4 text-muted-foreground" />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-6">
                  <div>
                    <Label htmlFor="shippingMethod" className="text-sm font-medium">
                      {t("shippingMethod")}
                    </Label>
                    <Select
                      value={formData.shippingMethod}
                      onValueChange={(value) => handleInputChange("shippingMethod", value)}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue>{getShippingMethodText(formData.shippingMethod)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="express">{t("shippingMethodExpress")}</SelectItem>
                        <SelectItem value="logistics">{t("shippingMethodLogistics")}</SelectItem>
                        <SelectItem value="pickup">{t("shippingMethodPickup")}</SelectItem>
                        <SelectItem value="dedicated">{t("shippingMethodDedicated")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="shippingContact" className="text-sm font-medium">
                      {t("shippingContact")}
                    </Label>
                    <Input
                      id="shippingContact"
                      value={formData.shippingContact}
                      onChange={(e) => handleInputChange("shippingContact", e.target.value)}
                      placeholder={t("enterShippingContact")}
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="shippingPhone" className="text-sm font-medium">
                      {t("shippingPhone")}
                    </Label>
                    <Input
                      id="shippingPhone"
                      value={formData.shippingPhone}
                      onChange={(e) => handleInputChange("shippingPhone", e.target.value)}
                      placeholder={t("enterShippingPhone")}
                      className="mt-1"
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 订单金额 */}
          <Card>
            <CardHeader className="bg-primary/10 border-b">
              <CardTitle className="text-lg text-primary">{t("orderAmount")}</CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <Label className="text-sm font-medium">{t("subtotal")}</Label>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-muted-foreground">
                      {formData.currency === "CNY" ? "¥" : "$"}
                    </span>
                    <Input
                      value={formData.subtotal}
                      readOnly
                      className="w-48 text-right bg-muted"
                    />
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <div className="flex items-center space-x-2">
                    <Label className="text-sm font-medium">{t("taxRate")}</Label>
                    <Input
                      type="number"
                      value={formData.taxRate}
                      onChange={(e) => handleInputChange("taxRate", e.target.value)}
                      className="w-20"
                      step="0.01"
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-muted-foreground">
                      {formData.currency === "CNY" ? "¥" : "$"}
                    </span>
                    <Input
                      value={formData.taxAmount}
                      readOnly
                      className="w-48 text-right bg-muted"
                    />
                  </div>
                </div>
                <div className="flex justify-between items-center">
                  <Label className="text-sm font-medium">{t("discount")}</Label>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm text-muted-foreground">
                      {formData.currency === "CNY" ? "¥" : "$"}
                    </span>
                    <Input
                      type="number"
                      value={formData.discount}
                      onChange={(e) => handleInputChange("discount", e.target.value)}
                      className="w-48 text-right"
                      step="0.01"
                    />
                  </div>
                </div>
                <div className="flex justify-between items-center pt-4 border-t">
                  <Label className="text-lg font-bold">{t("totalAmount")}</Label>
                  <div className="flex items-center space-x-2">
                    <span className="text-lg font-bold">
                      {formData.currency === "CNY" ? "¥" : "$"}
                    </span>
                    <Input
                      value={formData.totalAmount}
                      readOnly
                      className="w-48 text-right bg-primary/10 font-bold text-lg"
                    />
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 提交按钮 */}
          <div className="flex justify-center space-x-4 pt-6">
            <Button type="button" variant="outline" className="px-8">
              {tc("cancel")}
            </Button>
            <Button type="submit" className="px-8">
              {t("submitOrder")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
