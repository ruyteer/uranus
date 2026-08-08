import type { ServerResponse } from 'node:http'

/**
 * Empurra atualizações para os navegadores conectados via Server-Sent Events.
 *
 * **Por que SSE e não WebSocket.** O tráfego deste painel é de mão única:
 * servidor → navegador. As poucas ações que vão no sentido contrário (aprovar,
 * pausar) são requisições HTTP normais. SSE entrega isso sem dependência
 * nenhuma, sem código de framing e com reconexão automática embutida no
 * `EventSource` do navegador — que é justamente o que mais importa num painel
 * que fica aberto oito horas enquanto a rede oscila.
 *
 * O heartbeat existe porque proxies e antivírus derrubam conexões ociosas sem
 * avisar; um comentário a cada 15 s mantém o túnel vivo e detecta o cliente
 * morto quando a escrita falha.
 */
export class SseHub {
  private readonly clients = new Set<ServerResponse>()
  private heartbeat: NodeJS.Timeout | undefined
  private lastId = 0

  add(response: ServerResponse): void {
    response.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // O painel é local; sem isso, um proxy no meio pode bufferizar tudo e
      // transformar "tempo real" em "chega tudo junto no final".
      'x-accel-buffering': 'no',
    })
    response.write(': conectado\n\n')
    this.clients.add(response)

    const drop = (): void => {
      this.clients.delete(response)
    }
    response.on('close', drop)
    response.on('error', drop)

    this.startHeartbeat()
  }

  broadcast(event: string, data: unknown): void {
    if (this.clients.size === 0) return
    this.lastId++
    const payload = `id: ${String(this.lastId)}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const client of this.clients) {
      try {
        // `write` devolve false quando o buffer encheu — o cliente está lento,
        // não morto. Descartar aqui seria perder eventos de quem só está numa
        // rede ruim; o Node enfileira e entrega.
        client.write(payload)
      } catch {
        this.clients.delete(client)
      }
    }
  }

  get size(): number {
    return this.clients.size
  }

  close(): void {
    if (this.heartbeat !== undefined) clearInterval(this.heartbeat)
    this.heartbeat = undefined
    for (const client of this.clients) {
      try {
        client.end()
      } catch {
        /* já fechado */
      }
    }
    this.clients.clear()
  }

  private startHeartbeat(): void {
    if (this.heartbeat !== undefined) return
    this.heartbeat = setInterval(() => {
      for (const client of this.clients) {
        try {
          client.write(': ping\n\n')
        } catch {
          this.clients.delete(client)
        }
      }
    }, 15_000)
    this.heartbeat.unref()
  }
}
