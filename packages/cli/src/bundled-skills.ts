import { copyFile, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Skills embarcadas — conhecimento que o próprio Uranus carrega e instala em
 * todo projeto, sem depender de rede.
 *
 * Diferente do marketplace (`skills-catalog.ts`), que BUSCA o `SKILL.md` de um
 * repositório de terceiros quando o humano pede, uma skill embarcada vive em
 * `packages/cli/skills/<id>/` (versionada junto com o Uranus) e é copiada por
 * `writeClaudeConfig` a cada `init`/`claude`/`chat` — é parte do "treino" que
 * o Claude recebe, no mesmo nível do catálogo de agentes.
 *
 * Mesma regra de convivência dos agentes: o diretório instalado tem o prefixo
 * `uranus-` e é do Uranus (regenerado sempre); uma skill que o usuário
 * escreveu com outro nome nunca é tocada.
 */
export interface BundledSkill {
  /** Pasta de origem em `packages/cli/skills/` — sem o prefixo `uranus-`. */
  readonly id: string
  readonly title: string
  /** Uma frase: quando o Claude deve recorrer a ela. Vai para o `CLAUDE.md`. */
  readonly whenToUse: string
  /** Arquivos copiados. `SKILL.md` é obrigatório; o resto é referência que ele aponta. */
  readonly files: readonly string[]
}

export const BUNDLED_SKILLS: readonly BundledSkill[] = Object.freeze([
  {
    id: 'motion-video',
    title: 'Vídeo e motion',
    whenToUse:
      'qualquer pedido de vídeo: anúncio/Reels/TikTok/Shorts/YouTube, motion de produto, tutorial com a tela ' +
      'real, ou edição de vídeo gravado com legendas, efeitos sonoros e narração',
    files: ['SKILL.md', 'PLAYBOOK.md'],
  },
])

const INSTALLED_PREFIX = 'uranus-'

export function installedSkillDirName(id: string): string {
  return `${INSTALLED_PREFIX}${id}`
}

/** `packages/cli/skills/` — `..` serve tanto de `src/` (testes) quanto de `dist/` (build). */
export function bundledSkillsSourceDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', 'skills')
}

/**
 * Copia as skills embarcadas para `<claudeDir>/skills/uranus-<id>/`.
 * Devolve os caminhos escritos, relativos à raiz do projeto.
 */
export async function writeBundledSkills(
  claudeDir: string,
  sourceDir: string = bundledSkillsSourceDir(),
  skills: readonly BundledSkill[] = BUNDLED_SKILLS,
): Promise<string[]> {
  const wrote: string[] = []
  for (const skill of skills) {
    const dirName = installedSkillDirName(skill.id)
    const target = join(claudeDir, 'skills', dirName)
    await mkdir(target, { recursive: true })
    for (const file of skill.files) {
      await copyFile(join(sourceDir, skill.id, file), join(target, file))
      wrote.push(`.claude/skills/${dirName}/${file}`)
    }
  }
  return wrote
}
