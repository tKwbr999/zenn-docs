import { Client } from '@notionhq/client';
import dotenv from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import matter from 'gray-matter'; // front-matter パーサー
import { markdownToBlocks } from '@tryfabric/martian'; // Markdown -> Notion Block 変換

// .env ファイルから環境変数を読み込む
dotenv.config();

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const databaseId = process.env.NOTION_DATABASE_ID;

// 環境変数チェック
if (!process.env.NOTION_API_KEY || !databaseId) {
  console.error('Error: NOTION_API_KEY and NOTION_DATABASE_ID must be set in .env file.');
  process.exit(1);
}

// --- データベーススキーマ更新処理を追加 ---
const ensureDatabaseSchema = async () => {
  console.log(`Ensuring database schema for database ID: ${databaseId}`);
  try {
    const currentDatabase = await notion.databases.retrieve({ database_id: databaseId });
    const currentProperties = currentDatabase.properties;
    console.log('Retrieved current database properties.');

    const requiredProperties = {
      'Slug': { rich_text: {} }, // Frontmatter の notion_slug を格納
      'Tags': { multi_select: {} }, // Frontmatter の tags を格納
      'Published': { checkbox: {} }, // Frontmatter の published を格納
      // 'Name' (Title) は必須なので通常は存在
    };

    const propertiesToUpdate = {};
    let schemaNeedsUpdate = false;

    for (const propName in requiredProperties) {
      if (!currentProperties[propName]) {
        console.log(`Property "${propName}" not found. Adding to schema update.`);
        propertiesToUpdate[propName] = requiredProperties[propName];
        schemaNeedsUpdate = true;
      } else {
        console.log(`Property "${propName}" already exists.`);
        // オプション: 型が一致するかどうかもチェックする
        // const expectedType = Object.keys(requiredProperties[propName])[0];
        // if (currentProperties[propName].type !== expectedType) {
        //   console.warn(`Property "${propName}" exists but has wrong type (${currentProperties[propName].type}). Expected ${expectedType}.`);
        //   // 必要であれば更新対象にするなどの処理
        // }
      }
    }

    if (schemaNeedsUpdate) {
      console.log('Updating database schema...');
      await notion.databases.update({
        database_id: databaseId,
        properties: propertiesToUpdate,
      });
      console.log('Database schema updated successfully!');
    } else {
      console.log('Database schema is up-to-date.');
    }
  } catch (error) {
    console.error('Error ensuring database schema:', error);
    if (error.code === 'object_not_found') {
        console.error(`Database with ID ${databaseId} not found or not shared with the integration.`);
    } else if (error.body) {
        console.error('Notion API Error Body:', JSON.parse(error.body));
    }
    // スキーマ更新に失敗した場合、後続処理を中断すべきか検討
    throw new Error('Failed to ensure database schema. Aborting sync.');
  }
};
// --- スキーマ更新処理ここまで ---


// Markdown ファイルの Front Matter をパースする関数
const parseFrontMatter = (content) => {
  try {
    const { data, content: body } = matter(content);
    return { metadata: data, body };
  } catch (e) {
    console.error('Error parsing front matter:', e);
    return null;
  }
};

// Markdown 本文を Notion ブロック形式に変換する関数
const convertMarkdownToNotionBlocks = (markdown) => {
  try {
    const blocks = markdownToBlocks(markdown);
    const chunkedBlocks = [];
    for (let i = 0; i < blocks.length; i += 100) {
      chunkedBlocks.push(blocks.slice(i, i + 100));
    }
    return chunkedBlocks;
  } catch (e) {
    console.error('Error converting markdown to Notion blocks:', e);
    return null;
  }
};

// notion_slug を基に Notion ページを検索する関数
const findPageBySlug = async (slug) => {
  if (!slug) {
      console.error("Error: notion_slug is required to find a page.");
      return null;
  }
  try {
    console.log(`Searching for page with notion_slug: ${slug} in database: ${databaseId}`);
    const response = await notion.databases.query({
      database_id: databaseId,
      filter: {
        property: 'Slug', // DB プロパティ名 'Slug' を検索
        rich_text: {
          equals: slug,
        },
      },
    });
     if (response.results.length > 0) {
        console.log(`Found existing page with ID: ${response.results[0].id}`);
        return response.results[0];
     } else {
         console.log(`No existing page found with notion_slug: ${slug}`);
         return null;
     }
  } catch (error) {
    console.error(`Error finding page with notion_slug "${slug}":`, error);
    if (error.code === 'validation_error' && error.message.includes('property')) {
        console.error(`Property 'Slug' not found in database ${databaseId}. Please check the property name.`);
    }
    return null;
  }
};

// Notion ページを作成する関数
const createNotionPage = async (metadata, blocksChunks) => {
  const properties = {
    Name: { title: [{ text: { content: metadata.title || 'Untitled' } }] },
    Slug: { rich_text: [{ text: { content: metadata.notion_slug } }] },
  };
  if (metadata.tags) {
    properties.Tags = { multi_select: metadata.tags.map(tag => ({ name: tag })) };
  }
  if (metadata.published !== undefined) {
    properties.Published = { checkbox: metadata.published === true };
  }
  const pageIcon = metadata.emoji ? { type: 'emoji', emoji: metadata.emoji } : undefined;

  try {
    console.log(`Creating new page in database ${databaseId} with notion_slug: ${metadata.notion_slug}`);
    const response = await notion.pages.create({
      parent: { database_id: databaseId },
      properties: properties,
      icon: pageIcon,
      children: blocksChunks[0] || [],
    });
    console.log(`Page created with ID: ${response.id}`);

    for (let i = 1; i < blocksChunks.length; i++) {
      console.log(`Appending block chunk ${i + 1}/${blocksChunks.length} to page ${response.id}`);
      await notion.blocks.children.append({
        block_id: response.id,
        children: blocksChunks[i],
      });
       await new Promise(resolve => setTimeout(resolve, 300));
    }
    console.log(`All content added for page with notion_slug: ${metadata.notion_slug}`);
    return response;
  } catch (error) {
    console.error(`Error creating page with notion_slug "${metadata.notion_slug}":`, error);
    if (error.body) console.error('Notion API Error:', JSON.parse(error.body));
    return null;
  }
};

// Notion ページを更新する関数
const updateNotionPage = async (pageId, metadata, blocksChunks) => {
   const properties = {
    Name: { title: [{ text: { content: metadata.title || 'Untitled' } }] },
    Slug: { rich_text: [{ text: { content: metadata.notion_slug } }] },
  };
  if (metadata.tags) {
    properties.Tags = { multi_select: metadata.tags.map(tag => ({ name: tag })) };
  }
  if (metadata.published !== undefined) {
    properties.Published = { checkbox: metadata.published === true };
  }
  const pageIcon = metadata.emoji ? { type: 'emoji', emoji: metadata.emoji } : undefined;

  try {
    console.log(`Updating page ${pageId} with notion_slug: ${metadata.notion_slug}`);
    await notion.pages.update({
      page_id: pageId,
      properties: properties,
      icon: pageIcon,
    });
    console.log(`Page properties and icon updated for ${pageId}`);
    await new Promise(resolve => setTimeout(resolve, 300));

    console.log(`Deleting existing blocks for page ${pageId}...`);
    let hasMore = true;
    let startCursor = undefined;
    while (hasMore) {
      const response = await notion.blocks.children.list({
        block_id: pageId,
        start_cursor: startCursor,
      });
      for (const block of response.results) {
        try {
          await notion.blocks.delete({ block_id: block.id });
           await new Promise(resolve => setTimeout(resolve, 300));
        } catch (deleteError) {
          console.warn(`Could not delete block ${block.id}:`, deleteError.message);
        }
      }
      hasMore = response.has_more;
      startCursor = response.next_cursor;
    }
    console.log(`Existing blocks deleted for page ${pageId}`);

    console.log(`Adding new blocks to page ${pageId}...`);
    for (let i = 0; i < blocksChunks.length; i++) {
      console.log(`Appending block chunk ${i + 1}/${blocksChunks.length} to page ${pageId}`);
      await notion.blocks.children.append({
        block_id: pageId,
        children: blocksChunks[i],
      });
       await new Promise(resolve => setTimeout(resolve, 300));
    }
    console.log(`All content updated for page with notion_slug: ${metadata.notion_slug}`);
  } catch (error) {
    console.error(`Error updating page ${pageId} with notion_slug "${metadata.notion_slug}":`, error);
     if (error.body) console.error('Notion API Error:', JSON.parse(error.body));
  }
};

// 指定された Markdown ファイルを Notion に同期する関数
const syncFileToNotion = async (filePath) => {
  console.log(`Processing file: ${filePath}`);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const parsed = parseFrontMatter(content);

    if (!parsed || !parsed.metadata || !parsed.metadata.notion_slug) {
      console.warn(`Skipping ${filePath}: Missing notion_slug in front matter.`);
      return;
    }
    if (!parsed.metadata.title) {
        console.warn(`Skipping ${filePath}: Missing title in front matter.`);
        return;
    }

    const { metadata, body } = parsed;
    const blocksChunks = convertMarkdownToNotionBlocks(body);

    if (!blocksChunks) {
      console.warn(`Skipping ${filePath}: Could not convert markdown to Notion blocks.`);
      return;
    }

    const existingPage = await findPageBySlug(metadata.notion_slug);

    if (existingPage) {
      console.log(`Existing page found (ID: ${existingPage.id}). Updating...`);
      await updateNotionPage(existingPage.id, metadata, blocksChunks);
    } else {
      console.log(`No existing page found. Creating new page...`);
      await createNotionPage(metadata, blocksChunks);
    }
    console.log(`Successfully synced ${filePath} to Notion.`);

  } catch (error) {
    console.error(`Error processing file ${filePath}:`, error);
  }
};

// メイン処理
const main = async () => {
  // --- スキーマチェックを実行 ---
  try {
      await ensureDatabaseSchema();
  } catch (schemaError) {
      console.error("Aborting due to database schema error.");
      process.exit(1);
  }
  // --- スキーマチェックここまで ---


  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Error: Please provide the path to the markdown file as an argument.');
    console.log('Usage: node scripts/update-database-schema.js <path/to/your/markdown.md>');
    process.exit(1);
  }

  const filePath = args[0];

  try {
    await fs.access(filePath);
  } catch (error) {
    console.error(`Error: File not found at path: ${filePath}`);
    process.exit(1);
  }

  const absoluteFilePath = path.resolve(filePath);

  await syncFileToNotion(absoluteFilePath);
};

main();