declare module 'mammoth/mammoth.browser' {
  export interface ConvertToHtmlInput {
    arrayBuffer: ArrayBuffer;
    styleMap?: string[];
    includeDefaultStyleMap?: boolean;
  }
  export interface ConvertToHtmlOutput {
    value: string;
    messages: unknown[];
  }
  export function convertToHtml(input: ConvertToHtmlInput): Promise<ConvertToHtmlOutput>;
}
