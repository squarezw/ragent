"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, ExternalLink, ShoppingCart } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

export default function DemoPage() {
  const t = useTranslations("demo");

  const demos = [
    {
      title: t("businessTripForm"),
      description: t("businessTripFormDesc"),
      path: "/demo/business-trip-form",
      icon: FileText,
    },
    {
      title: t("salesOrder"),
      description: t("salesOrderDesc"),
      path: "/demo/sales-order",
      icon: ShoppingCart,
    },
  ];

  return (
    <div className="container mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {demos.map((demo) => {
          const Icon = demo.icon;
          return (
            <Card key={demo.path} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <Icon className="h-6 w-6 text-blue-600" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">{demo.title}</CardTitle>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">{demo.description}</p>
                <Link href={demo.path}>
                  <Button className="w-full">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    {t("viewDemo")}
                  </Button>
                </Link>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="mt-8 border-dashed">
        <CardContent className="pt-6">
          <div className="text-center">
            <p className="text-muted-foreground mb-2">{t("addNewDemoTip")}</p>
            <p className="text-sm text-muted-foreground">
              {t("addNewDemoInstruction")}{" "}
              <code className="bg-gray-100 px-2 py-1 rounded">/app/demo/</code>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
