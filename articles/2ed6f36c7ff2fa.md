---
title: "Goエンジニアが読み替える0から始めるtypescript"
emoji: "🐈"
type: "tech" # tech: 技術記事 / idea: アイデア
topics: []
published: false
---

## はじめに
typescriptでやることをgoでやることとマッピングしてパパッと理解してしまおうという企画。

typescriptを使う機会がAIツール群やAIエージェント実装などでめちゃくちゃ増えてきたのでしっかり覚えていきたいが最初はどうしてもとっつきにくく。

それを少しでも緩和するために知っていることと紐づけて覚えていこうという感じです。

## レッツマッピング

### 初期化
- go mod init hoge
- npx tsc --init

とりあえずこれやっとけ的にやるやつ。
goの場合はgo.modができて、typescriptの場合はtsconfig.jsonが出てくる。

  