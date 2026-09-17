/**
 * `mailparser` 没有自带类型声明，npm 上也没有与之匹配的 `@types/mailparser`。
 *
 * 与 `types/pdf-parse.d.ts` 同一手法：只声明本仓库真正用到的部分，不抄上游的完整结构——
 * 声明得越全，越容易在库升级时变成一句没人维护的谎话。收信侧只读 `text` / `html` /
 * 头部字段 / `attachments` 的文件名，其余一概不碰。
 */
declare module "mailparser" {
  interface MailParserAddress {
    value?: Array<{ name?: string; address?: string }>;
    /** 可读文本，形如 `"张三" <sales@corp.com>` */
    text?: string;
    html?: string;
  }

  interface MailParserAttachment {
    /** 已解码（RFC 2047 / RFC 2231）的文件名；只有带 filename 的 part 才有这个字段 */
    filename?: string;
    contentType?: string;
    contentDisposition?: string;
    contentId?: string;
    cid?: string;
    related?: boolean;
    content?: Buffer;
    size?: number;
  }

  /** 头部原始行：`key` 已小写，`line` 是完整的 `Key: value` 一行 */
  interface MailParserHeaderLine {
    key: string;
    line: string;
  }

  interface ParsedMail {
    text?: string;
    html?: string | false;
    subject?: string;
    messageId?: string;
    date?: Date;
    from?: MailParserAddress;
    to?: MailParserAddress | MailParserAddress[];
    cc?: MailParserAddress | MailParserAddress[];
    attachments?: MailParserAttachment[];
    headerLines?: MailParserHeaderLine[];
    headers?: Map<string, unknown>;
  }

  interface SimpleParserOptions {
    /** true 时不再把 HTML 翻译成纯文本塞进 `text`（收信侧依赖这个来区分「只有 HTML」） */
    skipHtmlToText?: boolean;
    /** true 时保持 HTML 原样，不改写内嵌图片的 cid 链接 */
    keepCidLinks?: boolean;
    skipTextToHtml?: boolean;
    skipImageLinks?: boolean;
    keepDeliveryStatus?: boolean;
    maxHtmlLengthToParse?: number;
  }

  function simpleParser(
    input: string | Buffer | NodeJS.ReadableStream,
    options?: SimpleParserOptions
  ): Promise<ParsedMail>;

  export { simpleParser };
  export type { MailParserAddress, MailParserAttachment, MailParserHeaderLine, ParsedMail };
}
