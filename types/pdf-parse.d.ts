declare module "pdf-parse" {
  interface PdfParseOptions {
    /** 自定义每页渲染（返回该页文本）；pageData 是 pdf.js 的 PDFPageProxy */
    // biome-ignore lint/suspicious/noExplicitAny: 第三方库内部对象
    pagerender?: (pageData: any) => string | Promise<string>;
    /** 最多解析的页数（0 = 全部） */
    max?: number;
    version?: string;
  }

  interface PdfParseResult {
    numpages: number;
    numrender: number;
    // biome-ignore lint/suspicious/noExplicitAny: 第三方库返回结构
    info: any;
    // biome-ignore lint/suspicious/noExplicitAny: 第三方库返回结构
    metadata: any;
    version: string;
    text: string;
  }

  function pdfParse(data: Buffer | Uint8Array, options?: PdfParseOptions): Promise<PdfParseResult>;
  export default pdfParse;
}
