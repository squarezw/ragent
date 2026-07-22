"use client";
import React, { useState } from "react";
import { useTranslations } from "next-intl";

export default function AboutPage() {
  const t = useTranslations("about");
  const [selected, setSelected] = useState(0);

  const VIDEO_SOURCES = [
    {
      label: t("hdQuality"),
      url: "https://public-1258530645.cos.ap-nanjing.myqcloud.com/RAgent-2k.mp4",
    },
    {
      label: t("smoothQuality"),
      url: "https://public-1258530645.cos.ap-nanjing.myqcloud.com/RAgent-720p.mp4",
    },
  ];

  return (
    <div className="flex flex-col items-center w-full min-h-[100vh] py-12 bg-muted">
      <div className="w-full px-12 flex flex-col items-center">
        <h1 className="text-3xl font-bold mb-4 text-foreground">{t("title")}</h1>
        <p className="mb-6 text-muted-foreground text-lg text-center max-w-2xl">
          {t("description")}
        </p>
        <div className="mb-4 flex gap-4">
          {VIDEO_SOURCES.map((src, idx) => (
            <button
              key={src.url}
              className={`px-4 py-2 rounded border text-base font-medium transition-colors ${selected === idx ? "bg-primary text-white border-blue-600" : "bg-card text-primary border-blue-300 hover:bg-blue-50"}`}
              onClick={() => setSelected(idx)}
            >
              {src.label}
            </button>
          ))}
        </div>
        <video
          key={VIDEO_SOURCES[selected].url}
          src={VIDEO_SOURCES[selected].url}
          controls
          className="w-full max-w-4xl rounded shadow mb-4"
          poster="/RAgent-poster.png"
        >
          {t("videoNotSupported")}
        </video>
        <div className="text-gray-400 text-sm">{t("switchResolutionTip")}</div>
      </div>
    </div>
  );
}
