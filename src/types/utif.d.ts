declare module 'utif' {
  /** One page (image file directory) of a TIFF file; tags are named t<number>. */
  export interface Ifd {
    [tag: string]: unknown
    width?: number
    height?: number
    data?: Uint8Array
  }
  const UTIF: {
    decode(buffer: ArrayBuffer): Ifd[]
    decodeImage(buffer: ArrayBuffer, ifd: Ifd, ifds?: Ifd[]): void
    toRGBA8(ifd: Ifd): Uint8Array
  }
  export default UTIF
}
