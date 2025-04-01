const fs = require('fs').promises; // Use promises version
const path = require('path');
const matter = require('gray-matter');
const { Client } = require('@notionhq/client');
const { markdownToBlocks } = require('@tryfabric/martian'); // Import martian
const dotenv = require('dotenv'); // Import dotenv

// Load environment variables from .env file (optional, for local testing)
dotenv.config();

const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

const parentId = process.env.NOTION_PARENT_ID; // Get parent ID from env
const repoRoot = process.cwd();

if (!process.env.NOTION_API_KEY) {
  console.error('Error: NOTION_API_KEY must be set.');
  process.exit(1);
}
// parentId is only required for creating new pages, check later

// Create Notion page properties from frontmatter
const createPageProperties = (frontmatter, relativeFilePath) => {
  const properties = {
    Name: { // Title property in Notion (must match your database)
      title: [
        {
          text: {
            content: frontmatter.title || path.basename(relativeFilePath, path.extname(relativeFilePath)), // Use filename if title missing
          },
        },
      ],
    },
    // --- Add other properties based on your frontmatter and Notion database ---
    Tags: { // Example: Multi-select property named "Tags"
      multi_select: (frontmatter.topics || []).map(topic => ({ name: topic })),
    },
    Published: { // Example: Checkbox property named "Published"
      checkbox: frontmatter.published === true, // Ensure boolean
    },
    Slug: { // Example: Text property named "Slug"
      rich_text: [
        {
          text: {
            content: path.basename(relativeFilePath, path.extname(relativeFilePath)), // Use filename as slug
          },
        },
      ],
    },
    // Icon property is handled separately during page create/update
    // Add more properties as needed...
  };
  return properties;
};

// Clear all blocks from a Notion page
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

  console.log(`[${pageId}] Found ${blocksToDelete.length} blocks to delete.`);

  // Delete blocks in reverse order, handling potential errors
  for (const block of blocksToDelete.reverse()) {
    await new Promise(resolve => setTimeout(resolve, 300)); // Delay to avoid rate limits
    try {
      console.log(`[${pageId}] Attempting to delete block: ${block.id} (Type: ${block.type})`);
      await notion.blocks.delete({ block_id: block.id });
      console.log(`[${pageId}] Successfully deleted block: ${block.id}`);
    } catch (error) {
      if (error.code === 'validation_error' && error.message.includes('archived')) {
        console.log(`[${pageId}] Skipping archived block: ${block.id}`);
      } else if (error.code === 'conflict_error') {
         console.warn(`[${pageId}] Conflict error deleting block ${block.id}. Might be already deleted or modified. Skipping.`);
      } else {
        console.warn(`[${pageId}] Could not delete block ${block.id} (Type: ${block.type}):`, error.message);
      }
    }
  }
};

// Append blocks to a Notion page (handling 100 block limit)
const appendBlocksToPage = async (pageId, blocks) => {
  const chunkSize = 100;
  for (let i = 0; i < blocks.length; i += chunkSize) {
    const chunk = blocks.slice(i, i + chunkSize);
    try {
      await notion.blocks.children.append({
        block_id: pageId,
        children: chunk,
      });
      await new Promise(resolve => setTimeout(resolve, 200)); // Add delay
    } catch (error) {
      console.error(`[${pageId}] Error appending blocks chunk ${Math.floor(i / chunkSize) + 1}:`, error);
      console.error('Failed blocks chunk:', JSON.stringify(chunk.map(b => b.type), null, 2));
      if (error.body) {
        console.error('Notion API Error Body:', error.body);
      }
      throw error;
    }
  }
};

// Add or update notionPageId in the Markdown file's frontmatter
const updateFrontmatterWithPageId = async (relativeFilePath, pageId) => {
  const fullPath = path.join(repoRoot, relativeFilePath);
  try {
    let fileContent = await fs.readFile(fullPath, 'utf-8');
    const { content: markdownBody, data: frontmatter } = matter(fileContent);

    // Check if notionPageId already exists and is the same
    if (frontmatter.notionPageId === pageId) {
      return; // No update needed
    }

    // Update or add notionPageId
    const newData = { ...frontmatter, notionPageId: pageId };
    const updatedContent = matter.stringify(markdownBody, newData);

    await fs.writeFile(fullPath, updatedContent, 'utf-8');
    console.log(`[${relativeFilePath}] Updated frontmatter with notionPageId: ${pageId}`);

  } catch (error) {
    console.error(`[${relativeFilePath}] Error updating frontmatter:`, error);
  }
};


// Sync a single Markdown file to Notion (Create or Update)
const syncFileToNotion = async (relativeFilePath) => {
  const fullPath = path.join(repoRoot, relativeFilePath);
  console.log(`\nProcessing file: ${relativeFilePath}`);
  try {
    const markdownContent = await fs.readFile(fullPath, 'utf-8');
    const { content: markdownBody, data: frontmatter } = matter(markdownContent);

    // Skip if 'notion: true' is not set
    if (frontmatter.notion !== true) {
      console.log(`[${relativeFilePath}] Skipping: 'notion: true' is not set in frontmatter.`);
      return;
    }

    // Skip if title is missing (Notion requires a title)
    if (!frontmatter.title) {
      console.warn(`[${relativeFilePath}] Skipping: Title is missing in frontmatter.`);
      return;
    }

    const notionBlocks = markdownToBlocks(markdownBody);
    const pageProperties = createPageProperties(frontmatter, relativeFilePath);
    const pageIcon = frontmatter.emoji ? { type: 'emoji', emoji: frontmatter.emoji } : undefined;

    let pageId = frontmatter.notionPageId;

    if (pageId) {
      // --- Update Existing Page ---
      console.log(`[${relativeFilePath}] Found notionPageId: ${pageId}. Attempting to update.`);
      try {
        // 1. Update page properties and icon
        await notion.pages.update({
          page_id: pageId,
          properties: pageProperties,
          icon: pageIcon,
          archived: false, // Ensure page is not archived
        });
        console.log(`[${pageId}] Page properties updated.`);
        await new Promise(resolve => setTimeout(resolve, 100)); // Delay

        // 2. Clear existing blocks
        console.log(`[${pageId}] Clearing existing blocks...`);
        await clearPageBlocks(pageId);
        console.log(`[${pageId}] Existing blocks cleared.`);
        await new Promise(resolve => setTimeout(resolve, 100)); // Delay

        // 3. Append new blocks
        console.log(`[${pageId}] Appending new blocks...`);
        await appendBlocksToPage(pageId, notionBlocks);
        console.log(`[${pageId}] New blocks appended.`);

        console.log(`[${relativeFilePath}] Successfully updated page: https://www.notion.so/${pageId.replace(/-/g, '')}`);

      } catch (error) {
        if (error.code === 'object_not_found') {
          console.warn(`[${relativeFilePath}] Page ${pageId} not found or archived. Will create a new page.`);
          pageId = null; // Reset pageId to trigger creation flow
        } else {
          console.error(`[${relativeFilePath}] Error updating page ${pageId}:`, error.message);
          if (error.body) console.error('Notion API Error Body:', error.body);
          pageId = null; // Attempt creation if update fails for other reasons
          console.warn(`[${relativeFilePath}] Resetting pageId due to update error. Will attempt to create a new page.`);
        }
      }
    }

    if (!pageId) {
      // --- Create New Page ---
      // Check if parentId is set before attempting creation
      if (!parentId) {
          console.error(`[${relativeFilePath}] Error: Cannot create new page because NOTION_PARENT_ID is not set.`);
          return; // Skip creation if parentId is missing
      }

      console.log(`[${relativeFilePath}] No notionPageId found or update failed. Creating new page...`);
      try {
        const response = await notion.pages.create({
          parent: { database_id: parentId }, // Use parentId here
          properties: pageProperties,
          icon: pageIcon,
          // Children are added via appendBlocksToPage
        });
        pageId = response.id;
        console.log(`[${relativeFilePath}] New page created with ID: ${pageId}`);
        await new Promise(resolve => setTimeout(resolve, 100)); // Delay

        // Append blocks to the new page
        console.log(`[${pageId}] Appending blocks to the new page...`);
        await appendBlocksToPage(pageId, notionBlocks);
        console.log(`[${pageId}] Blocks appended to the new page.`);

        // Add notionPageId to the Markdown file
        await updateFrontmatterWithPageId(relativeFilePath, pageId);

        console.log(`[${relativeFilePath}] Successfully created page: https://www.notion.so/${pageId.replace(/-/g, '')}`);

      } catch (error) {
        console.error(`[${relativeFilePath}] Error creating page:`, error.message);
        if (error.body) console.error('Notion API Error Body:', error.body);
      }
    }

  } catch (error) {
    console.error(`[${relativeFilePath}] Error processing file:`, error);
  }
};

// --- Main Execution ---
async function main() {
  // Get file paths from command line arguments
  const filePaths = process.argv.slice(2);

  if (filePaths.length === 0) {
    console.log('No changed markdown files provided as arguments. Exiting.');
    return;
  }

  console.log(`Starting Notion sync for ${filePaths.length} file(s)...`);

  // Process each file provided as an argument
  for (const filePath of filePaths) {
    // Ensure the path is relative to the repo root if needed,
    // but GitHub Actions usually provides paths relative to the workspace root.
    await syncFileToNotion(filePath);
    await new Promise(resolve => setTimeout(resolve, 500)); // Wait between processing files
  }

  console.log('\nNotion sync finished.');
}

main().catch(error => {
  console.error('\nSync process failed:', error);
  process.exit(1);
});