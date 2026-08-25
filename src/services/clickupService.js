const ClickUpAPI = require("../../app/clickupApi");
const { appSettings } = require("../config/settings");

function getClickUpClient(clientApiKey = "", clientListId = "") {
  const apiKey = clientApiKey || appSettings.CLICKUP_API_KEY || process.env.CLICKUP_API_KEY || "";
  const listId = clientListId || appSettings.CLICKUP_LIST_ID || process.env.CLICKUP_LIST_ID || "";
  return new ClickUpAPI(
    apiKey,
    listId,
    appSettings.CLICKUP_CUSTOM_FIELD_COMPANY_ID || process.env.CLICKUP_CUSTOM_FIELD_COMPANY_ID,
    appSettings.CLICKUP_STATUS_INVOICE || process.env.CLICKUP_STATUS_INVOICE,
    appSettings.CLICKUP_STATUS_DEFAULT || process.env.CLICKUP_STATUS_DEFAULT
  );
}

module.exports = {
  getClickUpClient,
};
