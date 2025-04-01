const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { Client } = require('@notionhq/client');

const notion = new Client({
  auth: process.env.NOTION_API_KEY
});

const repoRoot = process.cwd();

// マークダウンファイルを再帰的に検索
function findMarkdownFiles(dir) {
  const files = [];
  const items = fs.readdirSync(path.join(repoRoot, dir));
  
  for (const item of items) {
    const fullPath = path.join(repoRoot, dir, item);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory()) {
      files.push(...findMarkdownFiles(path.join(dir, item)));
    } else if (item.endsWith('.md') || item.endsWith('.mdx')) {
      files.push(path.join(dir, item));
    }
  }
  
  return files;
}

// マークダウンからテキストブロックを作成
function createBlocksFromMarkdown(markdown) {
  const blocks = [];
  const lines = markdown.split('\n');
  
  let currentParagraph = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.trim() === '') {
      if (currentParagraph.length > 0) {
        blocks.push({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                type: 'text',
                text: {
                  content: currentParagraph.join('\n')
                }
              }
            ]
          }
        });
        currentParagraph = [];
      }
    } else if (line.startsWith('# ')) {
      blocks.push({
        object: 'block',
        type: 'heading_1',
        heading_1: {
          rich_text: [
            {
              type: 'text',
              text: {
                content: line.substring(2)
              }
            }
          ]
        }
      });
    } else if (line.startsWith('## ')) {
      blocks.push({
        object: 'block',
        type: 'heading_2',
        heading_2: {
          rich_text: [
            {
              type: 'text',
              text: {
                content: line.substring(3)
              }
            }
          ]
        }
      });
    } else if (line.startsWith('### ')) {
      blocks.push({
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: [
            {
              type: 'text',
              text: {
                content: line.substring(4)
              }
            }
          ]
        }
      });
    } else {
      currentParagraph.push(line);
    }
  }
  
  // 最後のパラグラフがあれば追加
  if (currentParagraph.length > 0) {
    blocks.push({
      object: 'block',
      type: 'paragraph',
      paragraph: {
        rich_text: [
          {
            type: 'text',
            text: {
              content: currentParagraph.join('\n')
            }
          }
        ]
      }
    });
  }
  
  return blocks;
}

// Notionページを更新
async function updateNotionPage(pageId, title, blocks) {
  try {
    // ページプロパティを更新
    await notion.pages.update({
      page_id: pageId,
      properties: {
        Name: { // プロパティ名を 'Title' から 'Name' に変更
          title: [
            {
              text: {
                content: title
              }
            }
          ]
        }
      }
    });
    
    // 既存のブロックを削除
    const existingBlocks = await notion.blocks.children.list({
      block_id: pageId
    });
    
    for (const block of existingBlocks.results) {
      await notion.blocks.delete({
        block_id: block.id
      });
    }
    
    // 新しいブロックを追加
    const chunkSize = 100; // Notion APIの制限
    for (let i = 0; i < blocks.length; i += chunkSize) {
      const chunk = blocks.slice(i, i + chunkSize);
      await notion.blocks.children.append({
        block_id: pageId,
        children: chunk
      });
    }
    
    console.log(`Notionページ "${title}" (${pageId}) を更新しました。`);
  } catch (error) {
    console.error(`Notionページ "${title}" (${pageId}) の更新に失敗しました:`, error);
    throw new Error(`Notionページ "${title}" (${pageId}) の更新に失敗しました: ${error.message}`); // エラーを再スローしてmain関数でキャッチする
  }
}

async function main() {
  try {
    // 記事ディレクトリからマークダウンファイルを検索
    const articlesDir = 'articles';
    const booksDir = 'books';
    
    const markdownFiles = [
      ...findMarkdownFiles(articlesDir),
      ...findMarkdownFiles(booksDir)
    ];
    
    for (const filePath of markdownFiles) {
      const fileContent = fs.readFileSync(path.join(repoRoot, filePath), 'utf8');
      const { data, content } = matter(fileContent);
      
      // notion: trueが設定されていて、notionPageIdが存在する場合のみ処理
      if (data.notion === true && data.notionPageId) {
        console.log(`記事 "${filePath}" をNotionと同期します。`);
        
        // マークダウンからNotionブロックを作成
        const blocks = createBlocksFromMarkdown(content);
        
        // Notionページを更新
        await updateNotionPage(data.notionPageId, data.title || 'Untitled', blocks);
      }
    }
    
    console.log('Notionとの同期が完了しました。');
  } catch (error) {
    console.error('同期中にエラーが発生しました:', error);
    process.exit(1);
  }
}

main();