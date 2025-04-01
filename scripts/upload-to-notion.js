import fs from 'fs/promises';
import path from 'path';
import { Client } from '@notionhq/client';
import { markdownToBlocks } from '@tryfabric/martian';
import matter from 'gray-matter';
import dotenv from 'dotenv';

// .env ファイルから環境変数を読み込む
dotenv.config();

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const databaseId = process.env.NOTION_DATABASE_ID;

if (!process.env.NOTION_API_KEY || !databaseId) {
  console.error('Error: NOTION_API_KEY and NOTION_DATABASE_ID must be set in .env file.');
  process.exit(1);
}

// Notion ページのプロパティを Frontmatter から作成する関数
const createPageProperties = (frontmatter, filePath) => { // filePath を引数に追加
  const properties = {
    // タイトル (必須)
    Name: { // Notion データベースのタイトルプロパティ名に合わせてください
      title: [
        {
          text: {
            content: frontmatter.title || 'Untitled',
          },
        },
      ],
    },
    // トピック (マルチセレクトプロパティの例)
    Tags: { // Notion データベースのプロパティ名に合わせてください
      multi_select: (frontmatter.topics || []).map(topic => ({ name: topic })),
    },
    // 公開状態 (チェックボックスプロパティの例)
    Published: { // Notion データベースのプロパティ名に合わせてください
      checkbox: frontmatter.published || false,
    },
    // Zenn Slug (テキストプロパティの例)
    Slug: { // Notion データベースのプロパティ名に合わせてください
      rich_text: [
        {
          text: {
            content: path.basename(filePath, '.md'), // ファイル名を Slug とする例
          },
        },
      ],
    },
    // 絵文字 (テキストプロパティの例 - Notion ではアイコンとして設定可能)
    Icon: { // Notion データベースのプロパティ名に合わせてください
        rich_text: [
            {
                text: {
                    content: frontmatter.emoji || '📄'
                }
            }
        ]
    }
    // 必要に応じて他のプロパティを追加
  };
  return properties;
};

// 既存の Notion ページの全ブロックを削除する関数
const clearPageBlocks = async (pageId) => {
  let hasMore = true;
  let startCursor = undefined;
  const blocksToDelete = [];

  while (hasMore) {
    const response = await notion.blocks.children.list({
      block_id: pageId,
      start_cursor: startCursor,
    });
    blocksToDelete.push(...response.results);
    hasMore = response.has_more;
    startCursor = response.next_cursor;
  }

  console.log(`Found ${blocksToDelete.length} blocks to delete.`); // 追加: 取得したブロック数

  // Notion API は一度に削除できるブロック数に制限があるため、ループで削除
  // 削除は逆順で行うことで、子ブロックを持つブロックの削除問題を回避しやすくする
  for (const block of blocksToDelete.reverse()) {
    // 待機時間を追加して API 負荷を軽減
    await new Promise(resolve => setTimeout(resolve, 100)); // 100ミリ秒待機
    console.log(`Attempting to delete block: ${block.id} (Type: ${block.type})`); // 追加: 削除試行ログ
    try {
      await notion.blocks.delete({ block_id: block.id });
      console.log(`Successfully deleted block: ${block.id}`); // 追加: 削除成功ログ
    } catch (error) {
      // アーカイブ済みブロックのエラーは無視し、それ以外は警告を表示
      if (error.code === 'validation_error' && error.message.includes('archived')) {
        console.log(`Skipping archived block: ${block.id}`);
      } else {
        console.warn(`Could not delete block ${block.id} (Type: ${block.type}):`, error.message);
        // 競合エラーの場合は少し待ってリトライするなどの処理も検討可能
      }
    }
  }
};


// Notion ページにブロックを追加する関数 (100件ずつ分割)
const appendBlocksToPage = async (pageId, blocks) => {
  const chunkSize = 100; // Notion API の制限
  for (let i = 0; i < blocks.length; i += chunkSize) {
    const chunk = blocks.slice(i, i + chunkSize);
    try {
      await notion.blocks.children.append({
        block_id: pageId,
        children: chunk,
      });
    } catch (error) {
      console.error(`Error appending blocks chunk ${Math.floor(i / chunkSize) + 1}:`, error);
      // エラーが発生したブロックの内容をログに出力（デバッグ用）
      console.error('Failed blocks chunk:', JSON.stringify(chunk, null, 2));
      // エラーの詳細を出力
      if (error.body) {
        console.error('Notion API Error Body:', error.body);
      }
      throw error; // エラーを再スローして処理を中断
    }
  }
};

// Markdown ファイルを Notion にアップロードするメイン関数
const uploadMarkdownToNotion = async (filePath) => {
  console.log(`Processing file: ${filePath}`);
  try {
    const markdownContent = await fs.readFile(filePath, 'utf-8');
    const { content: markdownBody, data: frontmatter } = matter(markdownContent);

    if (!frontmatter.title) {
      console.warn(`Skipping ${filePath}: Title is missing in frontmatter.`);
      return;
    }

    const notionBlocks = markdownToBlocks(markdownBody);
    const pageProperties = createPageProperties(frontmatter, filePath); // filePath を渡す

    let pageId = frontmatter.notionPageId;

    if (pageId) {
      // --- 既存ページの更新 ---
      console.log(`Updating existing Notion page: ${pageId}`);
      try {
        // 1. ページのプロパティを更新
        await notion.pages.update({
          page_id: pageId,
          properties: pageProperties,
          // アイコンも更新する場合
          icon: frontmatter.emoji ? { type: 'emoji', emoji: frontmatter.emoji } : undefined,
          archived: false // アーカイブされていたら解除
        });
        console.log('Page properties updated.');

        // 2. 既存のブロックをクリア
        console.log('Clearing existing blocks...');
        await clearPageBlocks(pageId);
        console.log('Existing blocks cleared.');

        // 3. 新しいブロックを追加
        console.log('Appending new blocks...');
        await appendBlocksToPage(pageId, notionBlocks);
        console.log('New blocks appended.');

        console.log(`Successfully updated page: https://www.notion.so/${pageId.replace(/-/g, '')}`);

      } catch (error) {
        if (error.code === 'object_not_found') {
          console.warn(`Page ${pageId} not found or archived. Creating a new page instead.`);
          pageId = null; // ページが見つからない場合は新規作成フローへ
        } else {
          console.error(`Error updating page ${pageId}:`, error);
           if (error.body) {
             console.error('Notion API Error Body:', error.body);
           }
          return; // 更新エラーの場合は処理中断
        }
      }
    }

    if (!pageId) {
      // --- 新規ページの作成 ---
      console.log('Creating new Notion page...');
      try {
        const response = await notion.pages.create({
          parent: { database_id: databaseId },
          properties: pageProperties,
          // アイコンを設定する場合
          icon: frontmatter.emoji ? { type: 'emoji', emoji: frontmatter.emoji } : undefined,
          // children は append で追加
        });
        pageId = response.id;
        console.log(`New page created with ID: ${pageId}`);

        console.log('Appending blocks to the new page...');
        await appendBlocksToPage(pageId, notionBlocks);
        console.log('Blocks appended to the new page.');

        // Markdown ファイルに notionPageId を追記
        // ファイル内容を読み込み、notionPageId を追記/更新
        let fileContent = await fs.readFile(filePath, 'utf-8');
        const frontmatterRegex = /^---\s*([\s\S]*?)\s*---/;
        const match = fileContent.match(frontmatterRegex);

        if (match) {
          const frontmatterContent = match[1];
          const notionPageIdLine = `notionPageId: ${pageId}`;
           const notionPageIdRegex = /^notionPageId:\s*.*/m;

          if (notionPageIdRegex.test(frontmatterContent)) {
            // 既存の notionPageId 行を置換
            fileContent = fileContent.replace(notionPageIdRegex, notionPageIdLine);
            console.log(`Updated notionPageId in ${filePath}`);
          } else {
            // --- の直後に notionPageId 行を挿入
            const lines = fileContent.split('\n');
            lines.splice(1, 0, notionPageIdLine); // 2行目 (--- の次) に挿入
            fileContent = lines.join('\n');
            console.log(`Added notionPageId to ${filePath}`);
         }
          await fs.writeFile(filePath, fileContent, 'utf-8');
        } else {
          console.warn(`Could not find frontmatter in ${filePath}. notionPageId was not added.`);
        }

        console.log(`Successfully created page: https://www.notion.so/${pageId.replace(/-/g, '')}`);

      } catch (error) {
        console.error('Error creating page:', error);
        // エラーの詳細を出力
        if (error.body) {
            console.error('Notion API Error Body:', error.body);
        }
      }
    }

  } catch (error) {
    console.error(`Error processing file ${filePath}:`, error);
  }
};

// --- メイン処理 ---
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: bun scripts/upload-to-notion.js <markdown_file_path>');
  process.exit(1);
}

const filePath = args[0];

// ファイル存在確認
fs.access(filePath)
  .then(() => uploadMarkdownToNotion(filePath))
  .catch((err) => {
    console.error(`Error: File not found or inaccessible - ${filePath}`);
    process.exit(1);
  });