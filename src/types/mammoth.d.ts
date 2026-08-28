declare module 'mammoth/mammoth.browser' {
  export interface ConvertToHtmlInput {
    arrayBuffer: ArrayBuffer;
  }
  export interface ConvertToHtmlOutput {
    value: string;
    messages: any[];
  }
  export function convertToHtml(input: ConvertToHtmlInput): Promise<ConvertToHtmlOutput>;
}
