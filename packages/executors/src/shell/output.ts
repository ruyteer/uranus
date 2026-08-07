/**
 * Coletor de saída com teto de bytes.
 *
 * Preserva início E fim quando estoura: o começo tem o comando/contexto, o fim
 * tem o stack trace — e o diagnóstico de falha (R3) precisa dos dois. Descartar
 * só o fim é descartar exatamente a parte que classifica o erro.
 */
export class OutputCollector {
  private readonly headChunks: Buffer[] = []
  private readonly tailChunks: Buffer[] = []
  private headBytes = 0
  private tailBytes = 0
  private dropped = false

  constructor(
    private readonly maxBytes: number,
    private readonly headRatio = 0.4,
  ) {}

  push(chunk: Buffer): void {
    const headLimit = Math.floor(this.maxBytes * this.headRatio)
    if (this.headBytes < headLimit) {
      const take = Math.min(chunk.length, headLimit - this.headBytes)
      this.headChunks.push(chunk.subarray(0, take))
      this.headBytes += take
      if (take === chunk.length) return
      chunk = chunk.subarray(take)
    }

    const tailLimit = this.maxBytes - Math.floor(this.maxBytes * this.headRatio)
    this.tailChunks.push(chunk)
    this.tailBytes += chunk.length
    while (this.tailBytes > tailLimit && this.tailChunks.length > 0) {
      const first = this.tailChunks[0]!
      const excess = this.tailBytes - tailLimit
      if (first.length <= excess) {
        this.tailChunks.shift()
        this.tailBytes -= first.length
      } else {
        this.tailChunks[0] = first.subarray(excess)
        this.tailBytes -= excess
      }
      this.dropped = true
    }
  }

  get truncated(): boolean {
    return this.dropped
  }

  toString(): string {
    const head = Buffer.concat(this.headChunks).toString('utf8')
    const tail = Buffer.concat(this.tailChunks).toString('utf8')
    return this.dropped ? `${head}\n…[saída truncada]…\n${tail}` : head + tail
  }
}
