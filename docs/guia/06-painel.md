# 6. O painel web

← [Memória, backlog e vault](05-memoria-e-backlog.md) · Próximo: [Referência de comandos](07-comandos.md) →

```bash
uranus dashboard            # abre em http://localhost:4319
uranus dashboard --port 4321
```

O painel mostra o estado do projeto em tempo real. Tudo que dá para fazer pelo terminal dá para
fazer por ali, e vice-versa.

| Aba              | O que mostra                                               | Quando usar                                                     |
| ---------------- | ---------------------------------------------------------- | --------------------------------------------------------------- |
| **Backlog**      | Os pedidos, com progresso e subtasks                       | Tela principal — o que está pendente e o que andou              |
| **Terminal**     | Sessões reais do Claude ou de um shell, no navegador       | Conversar com o Claude sem sair do painel                       |
| **Instruções**   | As regras da casa que entram no `CLAUDE.md`                | Ensinar algo fixo ao Claude                                     |
| **Skills**       | Skills disponíveis para instalar no Claude Code            | Quando o Claude precisa de uma habilidade nova (PDF, design...) |
| **Configuração** | O mesmo que `uranus config`, com formulário                | Ajustar sem editar YAML                                         |
| **Vault**        | O grafo que liga memória, backlog e instruções             | Entender o que o Claude sabe e como está conectado              |
| **Sala**         | O Claude e os subagentes trabalhando ao vivo, em pixel art | Ver quem está fazendo o quê agora                               |
| **Memória**      | O conteúdo de `.uranus/memory/`                            | Conferir e corrigir o que foi aprendido                         |
| **Git**          | Commits e Pull Requests, com diff resumido                 | Revisar o que foi entregue                                      |

## Segurança

Por padrão o painel só aceita conexões do seu próprio computador (`127.0.0.1`). Para acessar de
outra máquina, configure um token — sem ele o servidor se recusa a subir:

```yaml
# .uranus/config.yaml
telemetry:
  dashboard:
    host: 0.0.0.0
    token: um-token-longo-e-aleatorio
```

---

← [Memória, backlog e vault](05-memoria-e-backlog.md) · Próximo: [Referência de comandos](07-comandos.md) →
