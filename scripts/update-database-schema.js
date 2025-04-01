import { Client } from '@notionhq/client';
import dotenv from 'dotenv';

// .env ファイルから環境変数を読み込む
dotenv.config();

const notion = new Client({ auth: process.env.NOTION_API_KEY });
const databaseId = process.env.NOTION_DATABASE_ID;

if (!process.env.NOTION_API_KEY || !databaseId) {
  console.error('Error: NOTION_API_KEY and NOTION_DATABASE_ID must be set in .env file.');
  process.exit(1);
}

// 追加したいプロパティの定義 (エラーメッセージに基づき、前回指定された名前を使用)
const propertiesToAdd = {
  Tags: { multi_select: {} },
  Published: { checkbox: {} },
  Slug: { rich_text: {} },
  Icon: { rich_text: {} }
};

const updateDatabaseSchema = async () => {
  try {
    // 1. 現在のデータベース定義を取得
    console.log('Retrieving current database schema...');
    const currentDatabase = await notion.databases.retrieve({ database_id: databaseId });
    const currentProperties = currentDatabase.properties;
    console.log('Current properties retrieved.');

    // 2. 新しいプロパティ定義を追加 (既存のものはそのまま保持)
    const updatedProperties = { ...currentProperties };
    let propertiesAddedCount = 0;
    for (const propertyName in propertiesToAdd) {
      if (!currentProperties[propertyName]) { // まだ存在しないプロパティのみ追加
        updatedProperties[propertyName] = propertiesToAdd[propertyName];
        propertiesAddedCount++;
        console.log(`Adding property: ${propertyName}`);
      } else {
        console.log(`Property "${propertyName}" already exists. Skipping.`);
      }
    }

    if (propertiesAddedCount === 0) {
        console.log('No new properties to add. Schema is up-to-date with required properties.');
        return;
    }

    // 3. データベースを更新
    console.log('Updating database schema...');
    await notion.databases.update({
      database_id: databaseId,
      properties: updatedProperties,
    });
    console.log('Database schema updated successfully!');

  } catch (error) {
    console.error('Error updating database schema:', error);
    if (error.body) {
      console.error('Notion API Error Body:', error.body);
    }
  }
};

updateDatabaseSchema();