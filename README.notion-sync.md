# Notion連携機能の使い方

このツールは、Zennの記事をNotionと連携するための機能を提供します。

## セットアップ

1. 必要なパッケージをインストールします:

```bash
npm install @notionhq/client gray-matter
```

2. Notionの統合を設定し、APIキーを取得します。

3. GitHubリポジトリのSecretsに以下を設定します:
   - `NOTION_API_KEY`: NotionのAPIキー
   - `NOTION_DATABASE_ID`: 連携先のNotionデータベースID

## 使用方法

### 1. 記事の作成

通常通りZennの記事を作成します:

```bash
npx zenn new:article
```

### 2. Notion連携の設定

記事を編集した後、以下のコマンドを実行してNotion連携を設定します:

```bash
node scripts/add-notion-frontmatter.js ./articles/my-article.md
```

これにより、記事のフロントマターに以下の情報が追加されます:

```yaml
notion: true
notionDir: articles
notionPageId: [Notionで自動生成されたページID]
```

### 3. 変更をプッシュ

変更をコミットしてプッシュします:

```bash
git add .
git commit -m "Add article with Notion sync"
git push origin main
```

GitHub Actionsが自動的に実行され、記事がNotionに同期されます。

## 注意事項

- フロントマターの`notion: true`と`notionPageId`が設定されている記事のみが同期されます。
- 記事ごとに保存先を指定したい場合は、`notionDir`の値を変更してください。
- マークダウンの複雑な要素（コードブロック、リスト、画像など）の変換には制限があります。