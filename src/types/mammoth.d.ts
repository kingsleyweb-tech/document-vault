declare module 'mammoth/mammoth.browser' {
  export interface ConvertToHtmlInput {
    arrayBuffer: ArrayBuffer;
  }
  export interface ConvertToHtmlOutput {
    value: string;
    messages: unknown[];
  }
  export function convertToHtml(input: ConvertToHtmlInput): Promise<ConvertToHtmlOutput>;
}
