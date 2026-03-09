import type { ToolsInput } from "@mastra/core/agent";
import type { CatalogManager } from "../../../application/managers/catalog.manager.js";
import { createListCatalogsTool } from "./list-catalogs.tool.js";
import { createListCatalogItemsTool } from "./list-catalog-items.tool.js";
import { createCreateCatalogTool } from "./create-catalog.tool.js";
import { createAddItemTool } from "./add-item.tool.js";
import { createUpdateItemTool } from "./update-item.tool.js";
import { createDeleteItemTool } from "./delete-item.tool.js";

export function createCatalogCrudTools(catalogManager: CatalogManager): ToolsInput {
  const listCatalogs = createListCatalogsTool(catalogManager);
  const listCatalogItems = createListCatalogItemsTool(catalogManager);
  const createCatalog = createCreateCatalogTool(catalogManager);
  const addCatalogItem = createAddItemTool(catalogManager);
  const updateCatalogItem = createUpdateItemTool(catalogManager);
  const deleteCatalogItem = createDeleteItemTool(catalogManager);

  return {
    listCatalogs,
    listCatalogItems,
    createCatalog,
    addCatalogItem,
    updateCatalogItem,
    deleteCatalogItem,
  };
}
