import { access, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Result } from '@uranus/core'
import { NotFoundError, ValidationError, err, ok } from '@uranus/core'

/**
 * Marketplace de skills — "busque skills famosas e deixe fácil de adicionar".
 *
 * O grosso do catálogo é o repositório oficial `anthropics/skills` (verificado
 * em 2026-08-18 via GitHub API: 18 skills, todas em `skills/<id>/SKILL.md` na
 * branch `main`). Instalar copia o `SKILL.md` de lá para
 * `.claude/skills/<id>/SKILL.md` neste projeto — o mesmo formato que o Claude
 * Code já lê sozinho, sem passar pelo mecanismo de plugin/marketplace dele.
 *
 * Só o `SKILL.md` é copiado, não a pasta inteira (scripts/templates que
 * algumas skills têm ao lado). Para a maioria das 18 isso já é o essencial —
 * é o texto que ensina o Claude; pastas com scripts continuam funcionando de
 * forma degradada (a instrução referencia um script que não veio junto). Uma
 * versão futura pode copiar a árvore inteira via GitHub API.
 *
 * O catálogo também inclui skills de outros repositórios oficiais além de
 * `anthropics/skills` — hoje só `find-skills`, do repo `vercel-labs/skills`
 * (o CLI `npx skills`). Por isso cada entrada carrega o próprio `sourceRepo`
 * em vez de assumir um único repositório fixo.
 */
export interface SkillCatalogEntry {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly official: boolean
  /** Repositório de origem, ex.: `"anthropics/skills"` ou `"vercel-labs/skills"`. */
  readonly sourceRepo: string
  /** Página do skill no GitHub, para o humano ler antes de instalar. */
  readonly sourceUrl: string
  /** De onde o conteúdo do `SKILL.md` é buscado na instalação. */
  readonly rawUrl: string
}

const ANTHROPICS_REPO = 'anthropics/skills'
const REPO = 'https://github.com/anthropics/skills/tree/main/skills'
const RAW = 'https://raw.githubusercontent.com/anthropics/skills/main/skills'

function entry(id: string, title: string, description: string): SkillCatalogEntry {
  return {
    id,
    title,
    description,
    official: true,
    sourceRepo: ANTHROPICS_REPO,
    sourceUrl: `${REPO}/${id}`,
    rawUrl: `${RAW}/${id}/SKILL.md`,
  }
}

/** Como `entry()`, mas para uma skill que mora fora de `anthropics/skills`. */
function externalEntry(
  id: string,
  title: string,
  description: string,
  options: { readonly sourceRepo: string; readonly sourceUrl: string; readonly rawUrl: string },
): SkillCatalogEntry {
  return { id, title, description, official: true, ...options }
}

export const SKILLS_CATALOG: readonly SkillCatalogEntry[] = Object.freeze([
  entry(
    'pdf',
    'PDF',
    'Extrai texto/tabelas, combina, divide, roda página, marca d’água, preenche formulário, faz OCR em PDF.',
  ),
  entry(
    'docx',
    'Word (.docx)',
    'Cria, lê e edita documentos Word — sumário, cabeçalhos, imagens, find-and-replace, tracked changes.',
  ),
  entry(
    'pptx',
    'PowerPoint (.pptx)',
    'Cria e edita apresentações — slides, templates, layouts, notas do apresentador.',
  ),
  entry(
    'xlsx',
    'Excel (.xlsx)',
    'Cria, edita e limpa planilhas — fórmulas, formatação, gráficos, dados bagunçados.',
  ),
  entry(
    'webapp-testing',
    'Teste de web apps',
    'Testa aplicações web locais com Playwright — screenshot, log do navegador, verificação de UI.',
  ),
  entry(
    'mcp-builder',
    'Construtor de MCP',
    'Guia para construir servidores MCP de qualidade (Python FastMCP ou Node/TypeScript).',
  ),
  entry(
    'skill-creator',
    'Criador de skills',
    'Cria, edita e mede a performance de outras skills — inclusive via benchmark.',
  ),
  entry(
    'frontend-design',
    'Design de frontend',
    'Direção estética para UI nova ou existente — tipografia e escolhas que não parecem template.',
  ),
  entry(
    'web-artifacts-builder',
    'Artefatos web complexos',
    'Artefatos HTML multi-componente com React, Tailwind e shadcn/ui — estado, rotas, componentes.',
  ),
  entry(
    'canvas-design',
    'Design em canvas',
    'Arte visual em .png/.pdf com filosofia de design — pôsteres, peças gráficas originais.',
  ),
  entry(
    'algorithmic-art',
    'Arte algorítmica',
    'Arte generativa com p5.js — flow fields, sistemas de partículas, aleatoriedade com seed.',
  ),
  entry(
    'theme-factory',
    'Fábrica de temas',
    'Aplica um de 10 temas visuais (cores/fontes) a slides, docs, relatórios e páginas HTML.',
  ),
  entry(
    'brand-guidelines',
    'Diretrizes de marca',
    'Aplica cores e tipografia oficiais de marca a qualquer artefato visual.',
  ),
  entry(
    'doc-coauthoring',
    'Co-autoria de documentos',
    'Fluxo estruturado para escrever documentação, propostas e specs técnicas junto com o usuário.',
  ),
  entry(
    'internal-comms',
    'Comunicação interna',
    'Escreve status report, update de liderança, newsletter, FAQ e relatório de incidente.',
  ),
  entry(
    'slack-gif-creator',
    'GIFs para Slack',
    'Cria GIFs animados otimizados para o Slack, com validação de tamanho/formato.',
  ),
  entry(
    'academy-guide',
    'Guia da Claude Academy',
    'Recomenda cursos e tutoriais da Claude Academy quando a pergunta é sobre como usar o Claude.',
  ),
  entry(
    'discernment-nudge',
    'Empurrão de discernimento',
    'Depois de uma resposta que o usuário vai usar (plano, estimativa, análise), sugere perguntas ' +
      'para checar fatos e suposições antes de agir em cima dela.',
  ),
  externalEntry(
    'find-skills',
    'Encontrar Skills',
    'Busca e recomenda skills prontas no ecossistema aberto (skills.sh) via "npx skills find" — ' +
      'para quando falta uma capacidade e provavelmente já existe skill pra ela.',
    {
      sourceRepo: 'vercel-labs/skills',
      sourceUrl: 'https://github.com/vercel-labs/skills/tree/main/skills/find-skills',
      rawUrl: 'https://raw.githubusercontent.com/vercel-labs/skills/main/skills/find-skills/SKILL.md',
    },
  ),
])

export interface InstallSkillResult {
  readonly id: string
  readonly path: string
}

/**
 * Copia o `SKILL.md` de uma skill do catálogo para `.claude/skills/<id>/` do
 * projeto. `fetchImpl` é injetável só para teste — em produção é o `fetch`
 * global do Node.
 */
export async function installSkill(
  projectDir: string,
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Result<InstallSkillResult>> {
  const entryFound = SKILLS_CATALOG.find((s) => s.id === id)
  if (entryFound === undefined) {
    return err(new NotFoundError(`Skill "${id}" não está no catálogo.`))
  }

  let response: Response
  try {
    response = await fetchImpl(entryFound.rawUrl)
  } catch (error: unknown) {
    return err(new ValidationError(`Falha de rede ao baixar a skill "${id}".`, { cause: error }))
  }
  if (!response.ok) {
    return err(
      new ValidationError(`Não deu para baixar "${id}" (HTTP ${String(response.status)}).`),
    )
  }
  const content = await response.text()

  const dir = join(projectDir, '.claude', 'skills', id)
  const path = join(dir, 'SKILL.md')
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(path, content, 'utf8')
  } catch (error: unknown) {
    return err(
      new ValidationError(`Falha ao gravar a skill "${id}" em disco.`, {
        cause: error,
        context: { path },
      }),
    )
  }
  return ok({ id, path })
}

export async function installedSkillIds(projectDir: string): Promise<readonly string[]> {
  const installed: string[] = []
  for (const skill of SKILLS_CATALOG) {
    const path = join(projectDir, '.claude', 'skills', skill.id, 'SKILL.md')
    try {
      await access(path)
      installed.push(skill.id)
    } catch {
      // não instalada
    }
  }
  return installed
}
