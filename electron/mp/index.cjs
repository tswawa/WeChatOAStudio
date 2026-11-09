// 统一公众号内容、互动、数据和官方 API，界面只调用业务操作而不接触会话凭据。
const { join } = require('node:path');
const { createMpTransport } = require('./transport.cjs');
const { createContentService } = require('./content.cjs');
const { createStatsService } = require('./stats.cjs');
const { createInteractionService } = require('./interaction.cjs');
const { createOfficialService } = require('./official.cjs');
const { createIncomeService } = require('./income.cjs');
const { createOfficialImageReader } = require('./official-images.cjs');
const { createImageNetwork } = require('../images/network.cjs');
const { createPublicationJournal } = require('./publications.cjs');
const { createWebPublicationService } = require('./web-publish.cjs');

function createMpService({ accounts, parent, dataDirectory, onAccountsChanged, onSessionReady, recoverSession, getImageProxy, onPublicationChanged }) {
  const transport = createMpTransport({ accounts, parent, onSessionReady, recoverSession });
  const content = createContentService({ transport });
  const stats = createStatsService({ transport, accounts, onAccountsChanged });
  const income = createIncomeService({ transport });
  const interaction = createInteractionService({ transport });
  const journal = createPublicationJournal(join(dataDirectory, 'official-publications.json')), locks = new Set();
  const official = createOfficialService({ journal, locks, settingsPath: join(dataDirectory, 'official-api.json'),
    readImage: createOfficialImageReader({ network: createImageNetwork({ getProxy: getImageProxy }) }),
    getAccount: (id) => accounts.find(id), getDraft: content.getDraft, getMassQuota: stats.getMassQuota });
  const ordinary = createWebPublicationService({ getAccount: id => accounts.find(id), getDraft: content.getDraft,
    getMassQuota: stats.getMassQuota, listPublished: content.listPublished, transport, journal, locks, notify: onPublicationChanged });
  const sections = {
    account: '/cgi-bin/settingpage?t=setting/index&action=index',
    members: '/cgi-bin/safecenterstatus?action=admins&t=setting/safe-admins',
  };

  function interactionAction(action, id, payload) {
    const handlers = {
      'interaction.reply': interaction.reply,
      'interaction.readMessage': interaction.readMessage,
      'interaction.featureComment': interaction.featureComment,
      'interaction.saveAutoReply': interaction.saveAutoReply,
      'interaction.saveMenu': interaction.saveMenu,
      'interaction.conversation': interaction.getConversation,
      'interaction.starredUsers': interaction.getStarredUsers,
      'interaction.searchMessages': interaction.searchMessages,
      'interaction.starUser': interaction.starUser,
      'interaction.blockMessageUser': interaction.blockMessageUser,
      'interaction.deleteConversation': interaction.deleteConversation,
      'interaction.messageMedia': interaction.messageMedia,
      'interaction.listMessages': interaction.listMessages,
      'interaction.saveMessageMedia': interaction.saveMessageMedia,
      'interaction.saveMessageSettings': interaction.saveMessageSettings,
      'interaction.messageFile': interaction.messageFile,
      'interaction.downloadMessageFile': interaction.downloadMessageFile,
    };
    if (!handlers[action]) throw new Error('不支持的互动操作');
    return handlers[action](id, payload);
  }

  function updateProfile(id, profile) {
    const previous = accounts.find(id);
    const updated = { ...previous };
    if (updated.avatar && !/^https:\/\/[^/?]*(?:qpic|qlogo)\.cn\//.test(updated.avatar)) updated.avatar = '';
    for (const key of ['name', 'subject', 'type', 'avatar']) {
      if (profile[key]) updated[key] = profile[key];
    }
    if (typeof profile.verified === 'boolean') updated.verified = profile.verified;
    if (previous && ['name', 'subject', 'type', 'avatar', 'verified']
      .some((key) => updated[key] !== previous[key])) {
      accounts.save(updated);
      onAccountsChanged();
    }
  }

  async function getInteractionPart(id, part) {
    const loaders = {
      comments: async () => ({ comments: await interaction.getComments(id) }),
      messages: async () => ({ messages: await interaction.getMessages(id) }),
      autoReply: async () => ({ autoReply: await interaction.getAutoReply(id) }),
      users: () => interaction.getUsers(id),
      account: async () => ({ account: await interaction.getAccount(id) }),
      members: async () => ({ members: await interaction.getMembers(id) }),
      menu: () => interaction.getMenu(id),
    };
    if (!loaders[part]) throw new Error('不支持的公众号数据分组');
    const result = await loaders[part]();
    if (result.account) updateProfile(id, result.account);
    return result;
  }

  async function getInteraction(id) {
    const result = await interaction.get(id);
    if (result.account) updateProfile(id, result.account);
    return result;
  }

  return {
    ...content, ...stats, ...income,
    getInteraction,
    getInteractionPart,
    interactionAction,
    openSection: (id, section) => transport.open(id, sections[section]),
    getApiConfig: official.getConfig,
    saveApiConfig: official.configure,
    testApi: official.test,
    publishOfficial: official.publish,
    publishOrdinary: ordinary.publish,
    showPublicationWindow: ordinary.focus,
    cancelPublication: ordinary.cancel,
    getApiPublications: official.listPublications,
    getPublishStatus: (id, result) => result.transport === 'web' ? ordinary.status(id, result.publicationId) : result.messageId
      ? official.getMassStatus(id, result.messageId) : official.getPublishStatus(id, result.publishId),
    release: transport.release,
    close: async () => { await ordinary.close(); await official.close(); await transport.close(); },
  };
}

module.exports = { createMpService };
