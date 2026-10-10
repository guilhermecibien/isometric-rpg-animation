# isometric-rpg-animation (Português)

Skill do Codex para criar, validar e integrar animações 2D isométricas naturais de personagens e monstros em jogos RPG com Phaser.js. É um repositório funcional: núcleo TypeScript independente de engine, adaptador Phaser 3, pipeline Python de sprites com validadores, demo jogável e testes.

## Problema
Pés que deslizam (velocidade ≠ passada da animação), troca de direção com tremor, confusão entre direção cartesiana e direção na tela, paradas em meio ao passo, pivôs que pulam, ordem de profundidade errada e movimento que não combina teclado com clique.

## Instalação rápida
```bash
python3 -m pip install -r requirements.txt && npm install
npm run assets:demo && npm run demo
npm test && npm run test:py && npm run test:e2e
```
Instalação como skill do Codex (local ou compartilhada): [references/installation.md](../../references/installation.md) (pasta `.agents/skills` do repositório ou `~/.agents/skills`).

## Uso com o Codex
> Use a skill $isometric-rpg-animation para criar todas as animações deste personagem a partir da imagem anexada e integrá-las ao meu jogo Phaser.js.
>
> Use a skill $isometric-rpg-animation para analisar a movimentação atual dos meus personagens e monstros, identificar os problemas e corrigir as animações preservando o estilo visual.

O fluxo: diagnóstico do projeto → plano → escolha do caminho de produção (spritesheet existente, partes articuladas 2D, Blender) → validação → preview → integração incremental → testes → relatório.

## Conceitos importantes
- **Direções são da tela** (`S SW W NW N NE E SE`). Com a projeção padrão, +x do mundo anda para baixo-direita (SE), não para leste. Sempre use `IsoProjection` + `DirectionResolver` ([convenções](../../references/isometric-conventions.md)).
- **Sincronia de passos**: a taxa de reprodução = velocidade no chão ÷ (distância por ciclo × fps ÷ quadros). `cycleTravel` no manifesto guarda a distância por ciclo.
- **Validação**: separa verificações *objetivas* (tamanhos, referências, aritmética dos marcadores de pé) de *heurísticas*. Passar nos testes **não** prova que o movimento é natural; revise os GIFs e o demo.
- **Fundo/magenta**: nunca removido automaticamente; use `isoanim bg detect` e depois `--color` explícito. Por padrão só remove pixels conectados à borda, preservando detalhes internos da mesma cor.

## Comandos
`python scripts/isoanim.py --help` (doctor, analyze, split, bg, align, atlas, process, articulated, from-frames, validate, preview, compare, generate-demo). Códigos de saída: 0 ok · 1 erros de validação · 2 entrada inválida · 3 ferramenta ausente.

## Limitações
Personagem do demo é um placeholder procedural; `analyze` não entende semanticamente a imagem; o script do Blender não foi executado no CI; providers de IA são apenas contratos; marcadores de pé só existem se fornecidos ou gerados; Windows/macOS e Phaser 4 não foram verificados pelo autor.

Licença: MIT.
