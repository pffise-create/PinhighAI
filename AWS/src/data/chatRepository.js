const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const crypto = require('crypto');

const USER_THREADS_TABLE = process.env.USER_THREADS_TABLE || 'golf-user-threads';
const MAX_CHAT_TURNS = parseInt(process.env.MAX_CHAT_TURNS || '12', 10);

let sharedDocumentClient = null;

function getDocumentClient(override) {
  if (override) {
    return override;
  }

  if (!sharedDocumentClient) {
    const client = new DynamoDBClient({});
    sharedDocumentClient = DynamoDBDocumentClient.from(client);
  }

  return sharedDocumentClient;
}

function toIsoString(input) {
  if (input instanceof Date) {
    return input.toISOString();
  }
  if (typeof input === 'number') {
    return new Date(input).toISOString();
  }
  return new Date().toISOString();
}

function buildTurn({ role, content, metadata }) {
  return {
    role,
    content,
    timestamp: toIsoString(Date.now()),
    metadata: metadata || null,
  };
}

function ensureArray(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  return [];
}

function trimTurns(turns, maxTurns) {
  const limit = Math.max(1, Math.min(maxTurns || MAX_CHAT_TURNS, MAX_CHAT_TURNS));
  if (turns.length <= limit) {
    return turns;
  }
  return turns.slice(turns.length - limit);
}

async function getThread({ userId, client } = {}) {
  if (!userId) {
    throw new Error('userId is required to load chat thread');
  }

  const documentClient = getDocumentClient(client);
  const command = new GetCommand({
    TableName: USER_THREADS_TABLE,
    Key: { user_id: userId },
  });

  const response = await documentClient.send(command);
  return response.Item || null;
}

function createNewThread(userId) {
  const timestamp = toIsoString(Date.now());
  return {
    user_id: userId,
    thread_id: `chat-loop-${crypto.randomUUID()}`,
    swing_count: 0,
    message_count: 0,
    created_at: timestamp,
    updated_at: timestamp,
    last_updated: timestamp,
    chat_history: [],
  };
}

async function putThread({ thread, client }) {
  const documentClient = getDocumentClient(client);
  const updatedThread = { ...thread, updated_at: toIsoString(Date.now()), last_updated: toIsoString(Date.now()) };
  const command = new PutCommand({
    TableName: USER_THREADS_TABLE,
    Item: updatedThread,
  });
  await documentClient.send(command);
  return updatedThread;
}

async function ensureThread({ userId, client }) {
  const existing = await getThread({ userId, client });
  if (existing) {
    const history = ensureArray(existing.chat_history);
    return { ...existing, chat_history: trimTurns(history, MAX_CHAT_TURNS) };
  }
  const created = createNewThread(userId);
  await putThread({ thread: created, client });
  return created;
}

function appendTurnToThread(thread, turn) {
  const history = ensureArray(thread.chat_history);
  const updatedHistory = trimTurns([...history, turn], MAX_CHAT_TURNS);
  return {
    ...thread,
    chat_history: updatedHistory,
    message_count: (thread.message_count || 0) + 1,
    last_updated: turn.timestamp,
  };
}

async function recordTurn({ userId, role, content, metadata, client }) {
  if (!userId) {
    throw new Error('userId is required to record chat turn');
  }
  if (!role || !content) {
    throw new Error('role and content are required to record chat turn');
  }

  const documentClient = getDocumentClient(client);
  const thread = await ensureThread({ userId, client: documentClient });
  const turn = buildTurn({ role, content, metadata });
  const updated = appendTurnToThread(thread, turn);
  await putThread({ thread: updated, client: documentClient });
  return turn;
}

async function getRecentTurns({ userId, client, limit = MAX_CHAT_TURNS }) {
  const thread = await getThread({ userId, client });
  if (!thread) {
    return [];
  }
  const history = ensureArray(thread.chat_history);
  return trimTurns(history, limit);
}

module.exports = {
  MAX_CHAT_TURNS,
  ensureThread,
  recordTurn,
  getRecentTurns,
  appendTurnToThread, // exported for testing
};
