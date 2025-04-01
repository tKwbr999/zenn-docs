const { Client } = require('@notionhq/client');
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter'); // フロントマターを解析するためのライブラリ

const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

const databaseId = process.env.NOTION_DATABASE_ID;
const repoRoot = process.cwd();

// 既存の記事を取得してnotion: trueのものを見つける
async function findExistingArticles() {
  // リポジトリをスキャンしてマークダウンファイルを探す
  const markdownFiles = scanDirectory('content'); // contentディレクトリを起点に検索

  const notionArticles = [];

  for (const filePath of markdownFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    const { data } = matter(content);

    if (data.notion === true && data['notion-directory']) {
      notionArticles.push({
        filePath,
        frontMatter: data,
        notionPageId: data.notionPageId || null,
        notionDirectory: data['notion-directory'],
      });
    }
  }

  return notionArticles;
}

// ディレクトリを再帰的にスキャンしてマークダウンファイルを見つける
function scanDirectory(dir) {
  const files = [];
  const items = fs.readdirSync(path.join(repoRoot, dir));

  for (const item of items) {
    const fullPath = path.join(repoRoot, dir, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory()) {
      files.push(...scanDirectory(path.join(dir, item)));
    } else if (item.endsWith('.md') || item.endsWith('.mdx')) {
      files.push(path.join(dir, item));
    }
  }

  return files;
}

async function getPageContent(pageId) {
  try {
    const blocks = await notion.blocks.children.list({
      block_id: pageId,
    });

    // ブロックをマークダウンに変換
    let markdown = '';
    for (const block of blocks.results) {
      if (block.type === 'paragraph' && block.paragraph.rich_text.length > 0) {
        markdown += block.paragraph.rich_text.map((text) => text.plain_text).join('') + '\n\n';
      }
      // 他のブロックタイプ処理を追加
    }

    return markdown;
  } catch (error) {
    console.error(`Error getting page content for ${pageId}:`, error);
    return '';
  }
}

async function main() {
  // notion: trueのフロントマターを持つ記事を探す
  const notionArticles = await findExistingArticles();

  for (const article of notionArticles) {
    if (!article.notionPageId) {
      console.log(`Skipping article at ${article.filePath}: No Notion page ID specified`);
      continue;
    }

    // Notionからコンテンツを取得
    const content = await getPageContent(article.notionPageId);

    if (!content) {
      console.log(`No content retrieved for ${article.notionPageId}`);
      continue;
    }

    // フロントマターを保持したまま、コンテンツを更新
    const frontMatterString = matter.stringify(content, article.frontMatter);

    // 指定されたディレクトリにファイルを保存
    const targetDir = path.join(repoRoot, article.notionDirectory);

    // ディレクトリが存在しない場合は作成
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // ファイル名は元のファイル名を保持または新しく生成
    const fileName = path.basename(article.filePath);
    const targetPath = path.join(targetDir, fileName);

    fs.writeFileSync(targetPath, frontMatterString);
    console.log(`Updated article at ${targetPath}`);
  }
}

main().catch(console.error);
