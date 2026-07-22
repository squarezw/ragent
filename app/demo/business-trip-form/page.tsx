"use client";

import { useState } from "react";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Calendar, Search, User, Car, MapPin } from "lucide-react";
import { useTranslations } from "next-intl";

export default function BusinessTripFormPage() {
  const t = useTranslations("businessTrip");
  const tc = useTranslations("common");
  const [formData, setFormData] = useState({
    // 发票信息
    buyerName: "",
    buyerTaxId: "",
    sellerName: "",
    sellerTaxId: "",
    totalAmount: "",

    // 出差主体信息
    tripType: "outOfCity",
    applicationStartDate: "2022-06-07 09:00",
    applicationEndDate: "2022-06-07 20:10",
    applicationTotalDays: "1.00",
    actualStartDate: "",
    actualEndDate: "",
    actualTotalDays: "1.00",
    destination: "nanjing",
    accompanyingPersonnel: "",
    travelMethod: "selfDrive",
    travelMode: "privateCar",
    startingPoint: t("defaultStartingPoint"),
    endingPoint: t("defaultEndingPoint"),
    selfAccompanying: "yes",
    mileage: "300.00",
  });

  const handleInputChange = (field: string, value: string) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log("Form submitted:", formData);
    alert(t("formSubmitted"));
  };

  return (
    <div className="min-h-screen bg-background py-8">
      <div className="max-w-4xl mx-auto px-4">
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

        {/* 单位信息 */}
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
          {/* 发票信息 */}
          <Card>
            <CardHeader className="bg-primary/10 border-b">
              <CardTitle className="text-lg text-primary">{t("invoiceInfo")}</CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="space-y-6">
                {/* 购买方信息 和 销售方信息 */}
                <div className="grid grid-cols-2 gap-6">
                  {/* 购买方信息 */}
                  <div>
                    <Label className="text-sm font-semibold mb-3 block">1. {t("buyerInfo")}</Label>
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="buyerName" className="text-sm font-medium">
                          {t("name")}
                        </Label>
                        <Input
                          id="buyerName"
                          value={formData.buyerName}
                          onChange={(e) => handleInputChange("buyerName", e.target.value)}
                          placeholder={t("enterBuyerName")}
                          className="mt-1"
                        />
                      </div>

                      <div>
                        <Label htmlFor="buyerTaxId" className="text-sm font-medium">
                          {t("taxId")}
                        </Label>
                        <Input
                          id="buyerTaxId"
                          value={formData.buyerTaxId}
                          onChange={(e) => handleInputChange("buyerTaxId", e.target.value)}
                          placeholder={t("enterTaxId")}
                          className="mt-1"
                        />
                      </div>
                    </div>
                  </div>

                  {/* 销售方信息 */}
                  <div>
                    <Label className="text-sm font-semibold mb-3 block">2. {t("sellerInfo")}</Label>
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="sellerName" className="text-sm font-medium">
                          {t("name")}
                        </Label>
                        <Input
                          id="sellerName"
                          value={formData.sellerName}
                          onChange={(e) => handleInputChange("sellerName", e.target.value)}
                          placeholder={t("enterSellerName")}
                          className="mt-1"
                        />
                      </div>

                      <div>
                        <Label htmlFor="sellerTaxId" className="text-sm font-medium">
                          {t("taxId")}
                        </Label>
                        <Input
                          id="sellerTaxId"
                          value={formData.sellerTaxId}
                          onChange={(e) => handleInputChange("sellerTaxId", e.target.value)}
                          placeholder={t("enterTaxId")}
                          className="mt-1"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* 价税合计 */}
                <div>
                  <Label htmlFor="totalAmount" className="text-sm font-semibold">
                    {t("totalAmount")}
                  </Label>
                  <div className="flex items-center space-x-2 mt-2">
                    <span className="text-sm text-muted-foreground">¥</span>
                    <Input
                      id="totalAmount"
                      value={formData.totalAmount}
                      onChange={(e) => handleInputChange("totalAmount", e.target.value)}
                      placeholder="0.00"
                      type="number"
                      step="0.01"
                      className="w-64"
                    />
                    <span className="text-sm text-muted-foreground">{t("yuan")}</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* 出差主体信息 */}
          <Card>
            <CardHeader className="bg-primary/10 border-b">
              <CardTitle className="text-lg text-primary">{t("tripMainInfo")}</CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="space-y-6">
                {/* 出差类型 */}
                <div>
                  <Label className="text-sm font-medium mb-3 block">{t("tripType")}</Label>
                  <RadioGroup
                    value={formData.tripType}
                    onValueChange={(value) => handleInputChange("tripType", value)}
                    className="flex space-x-6"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="withinDistrict" id="withinDistrict" />
                      <Label htmlFor="withinDistrict">{t("withinDistrict")}</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="withinCity" id="withinCity" />
                      <Label htmlFor="withinCity">{t("withinCity")}</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="outOfCity" id="outOfCity" />
                      <Label htmlFor="outOfCity">{t("outOfCity")}</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="overseas" id="overseas" />
                      <Label htmlFor="overseas">{t("overseas")}</Label>
                    </div>
                  </RadioGroup>
                </div>

                {/* 申请出差日期 */}
                <div>
                  <Label className="text-sm font-medium mb-3 block">
                    {t("applicationTripDate")}
                  </Label>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <Label htmlFor="applicationStartDate" className="text-xs">
                        {t("startDate")}
                      </Label>
                      <div className="flex items-center space-x-2 mt-1">
                        <Input
                          id="applicationStartDate"
                          value={formData.applicationStartDate}
                          onChange={(e) =>
                            handleInputChange("applicationStartDate", e.target.value)
                          }
                        />
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="applicationEndDate" className="text-xs">
                        {t("endDate")}
                      </Label>
                      <div className="flex items-center space-x-2 mt-1">
                        <Input
                          id="applicationEndDate"
                          value={formData.applicationEndDate}
                          onChange={(e) => handleInputChange("applicationEndDate", e.target.value)}
                        />
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">{t("totalDays")}</Label>
                      <div className="text-sm text-muted-foreground mt-1 bg-muted px-3 py-2 rounded">
                        {formData.applicationTotalDays}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 实际出差日期 */}
                <div>
                  <Label className="text-sm font-medium mb-3 block">{t("actualTripDate")}</Label>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <Label htmlFor="actualStartDate" className="text-xs">
                        {t("startDate")}
                      </Label>
                      <Input
                        id="actualStartDate"
                        value={formData.actualStartDate}
                        onChange={(e) => handleInputChange("actualStartDate", e.target.value)}
                        placeholder="-"
                      />
                    </div>
                    <div>
                      <Label htmlFor="actualEndDate" className="text-xs">
                        {t("endDate")}
                      </Label>
                      <Input
                        id="actualEndDate"
                        value={formData.actualEndDate}
                        onChange={(e) => handleInputChange("actualEndDate", e.target.value)}
                        placeholder="-"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">{t("totalDays")}</Label>
                      <div className="text-sm text-muted-foreground mt-1 bg-muted px-3 py-2 rounded">
                        {formData.actualTotalDays}
                      </div>
                    </div>
                  </div>
                </div>

                {/* 出差地和同行人员 */}
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <Label htmlFor="destination" className="text-sm font-medium">
                      {t("destination")}
                    </Label>
                    <Select
                      value={formData.destination}
                      onValueChange={(value) => handleInputChange("destination", value)}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="nanjing">{t("cityNanjing")}</SelectItem>
                        <SelectItem value="beijing">{t("cityBeijing")}</SelectItem>
                        <SelectItem value="shanghai">{t("cityShanghai")}</SelectItem>
                        <SelectItem value="shenzhen">{t("cityShenzhen")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="accompanyingPersonnel" className="text-sm font-medium">
                      {t("accompanyingPersonnel")}
                    </Label>
                    <div className="flex items-center space-x-2 mt-1">
                      <Input
                        id="accompanyingPersonnel"
                        value={formData.accompanyingPersonnel}
                        onChange={(e) => handleInputChange("accompanyingPersonnel", e.target.value)}
                        placeholder={t("selectPersonnel")}
                        className="flex-1"
                      />
                      <Search className="h-4 w-4 text-muted-foreground" />
                      <User className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                </div>

                {/* 交通工具和出行方式 */}
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <Label htmlFor="travelMethod" className="text-sm font-medium">
                      {t("travelMethod")}
                    </Label>
                    <Select
                      value={formData.travelMethod}
                      onValueChange={(value) => handleInputChange("travelMethod", value)}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="selfDrive">{t("selfDrive")}</SelectItem>
                        <SelectItem value="airplane">{t("airplane")}</SelectItem>
                        <SelectItem value="train">{t("train")}</SelectItem>
                        <SelectItem value="highSpeedRail">{t("highSpeedRail")}</SelectItem>
                        <SelectItem value="car">{t("car")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="travelMode" className="text-sm font-medium">
                      {t("travelMode")}
                    </Label>
                    <Select
                      value={formData.travelMode}
                      onValueChange={(value) => handleInputChange("travelMode", value)}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="privateCar">{t("privateCar")}</SelectItem>
                        <SelectItem value="companyCar">{t("companyCar")}</SelectItem>
                        <SelectItem value="taxi">{t("taxi")}</SelectItem>
                        <SelectItem value="publicTransport">{t("publicTransport")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* 出行起始地和目的地 */}
                <div>
                  <Label className="text-sm font-medium mb-3 block">{t("travelRoute")}</Label>
                  <div className="flex items-center space-x-4">
                    <div className="flex-1">
                      <Label htmlFor="startingPoint" className="text-xs">
                        {t("startingPoint")}
                      </Label>
                      <Input
                        id="startingPoint"
                        value={formData.startingPoint}
                        onChange={(e) => handleInputChange("startingPoint", e.target.value)}
                        className="mt-1"
                      />
                    </div>
                    <div className="flex items-center">
                      <span className="text-sm text-muted-foreground">{t("to")}</span>
                    </div>
                    <div className="flex-1">
                      <Label htmlFor="endingPoint" className="text-xs">
                        {t("endingPoint")}
                      </Label>
                      <Input
                        id="endingPoint"
                        value={formData.endingPoint}
                        onChange={(e) => handleInputChange("endingPoint", e.target.value)}
                        className="mt-1"
                      />
                    </div>
                  </div>
                </div>

                {/* 本人同行和里程 */}
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <Label htmlFor="selfAccompanying" className="text-sm font-medium">
                      {t("selfAccompanying")}
                    </Label>
                    <Select
                      value={formData.selfAccompanying}
                      onValueChange={(value) => handleInputChange("selfAccompanying", value)}
                    >
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="yes">{tc("yes")}</SelectItem>
                        <SelectItem value="no">{tc("no")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="mileage" className="text-sm font-medium">
                      {t("mileage")}
                    </Label>
                    <div className="flex items-center space-x-2 mt-1">
                      <Input
                        id="mileage"
                        value={formData.mileage}
                        onChange={(e) => handleInputChange("mileage", e.target.value)}
                      />
                      <span className="text-sm text-muted-foreground">{t("kilometers")}</span>
                    </div>
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
              {t("submitApplication")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
