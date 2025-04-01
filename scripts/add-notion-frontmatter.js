require('dotenv').config(); // .envファイルを読み込む
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { Client } = require('@notionhq/client');

console.log('DEBUG: NOTION_API_KEY:', process.env.NOTION_API_KEY); // デバッグ用: APIキーの値を確認
console.log('DEBUG: NOTION_DATABASE_ID:', process.env.NOTION_DATABASE_ID); // デバッグ用: データベースIDの値を確認

// Notionクライアントの初期化
const notion = new Client({
  auth: process.env.NOTION_API_KEY || 'your-notion-api-key',
});

const databaseId = process.env.NOTION_DATABASE_ID || 'your-notion-database-id';

// コマンドライン引数からファイルパスを取得
const filePath = process.argv[2];
const notionDirPath = process.argv[3] || 'articles'; // デフォルトは 'articles'

if (!filePath) {
  console.error(
    'ファイルパスを指定してください。例: node add-notion-frontmatter.js ./articles/my-article.md'
  );
  process.exit(1);
}

async function createNotionPage(title, content) {
  try {
    const response = await notion.pages.create({
      parent: { database_id: databaseId },
      properties: { // プロパティ名を Title から Name に変更
        Name: {
          title: [
            {
              type: 'text', // typeを追加
              text: {
                content: title,
              },
            },
          ],
        },
      },
      children: [
        {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                type: 'text',
                text: {
                  content: '記事内容はGitHubと同期されます。',
                },
              },
            ],
          },
        },
      ],
    });

    return response.id;
  } catch (error) {
    console.error('Notionページの作成に失敗しました:', error);
    throw error;
  }
}

async function main() {
  try {
    // ファイルの読み込み
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const { data, content } = matter(fileContent);

    // すでにnotion: trueが設定されている場合はスキップ
    if (data.notion === true) {
      console.log('この記事はすでにNotion連携が設定されています。');
      return;
    }

    // Notionページを作成
    const pageId = await createNotionPage(data.title || 'Untitled', content);

    // フロントマターを更新
    data.notion = true;
    data.notionDir = notionDirPath;
    data.notionPageId = pageId;

    // 更新したフロントマターでファイルを書き込み
    const updatedContent = matter.stringify(content, data);
    fs.writeFileSync(filePath, updatedContent);

    console.log(`記事 "${filePath}" にNotion連携の設定を追加しました。`);
    console.log(`Notion Page ID: ${pageId}`);
  } catch (error) {
    console.error('エラーが発生しました:', error);
    process.exit(1);
  }
}

main();
