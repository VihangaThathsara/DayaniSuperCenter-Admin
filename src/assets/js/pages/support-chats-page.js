import { onPageLeave } from '../page-lifecycle.js';
import '../main.js';
import { renderShell } from '../ui-shell.js';
import { markSupportChatReadByAdmin, sendSupportReply, watchSupportChats, watchSupportMessages } from '../data-service.js';
import { formatDate } from '../utils.js';
import { bindProfilePhoto } from '../profile-photo.js';

export async function mount(user) {
const page = renderShell({
  pageTitle: 'Support Chats',
  activePage: 'support-chats.html',
  user
});
const getElement = (id) => page.querySelector('#' + id);


page.innerHTML = `
  <style>
    .support-chat-user-avatar {
      width: 46px;
      height: 46px;
      border-radius: 50%;
      object-fit: cover;
      flex-shrink: 0;
      background: #e9ecef;
    }
    .support-chat-user-fallback {
      width: 46px;
      height: 46px;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      background: rgba(255,255,255,.18);
      color: inherit;
      flex-shrink: 0;
    }
    .support-chat-user-fallback.header-fallback {
      background: #198754;
      color: #fff;
    }
  </style>
  <div class="row g-3 support-chat-page">
    <div class="col-12 col-xl-4">
      <div class="card border-0 shadow-sm h-100">
        <div class="card-body p-0">
          <div class="p-3 border-bottom">
            <div class="fw-semibold">Customer Conversations</div>
            <div class="small text-secondary">Tap any user to open the live chat.</div>
          </div>
          <div id="supportChatList" class="list-group list-group-flush"></div>
        </div>
      </div>
    </div>
    <div class="col-12 col-xl-8">
      <div class="card border-0 shadow-sm h-100">
        <div class="card-body d-flex flex-column" style="min-height: 70vh;">
          <div id="supportChatHeader" class="border-bottom pb-3 mb-3">
            <div class="fw-semibold">Select a conversation</div>
            <div class="small text-secondary">User email and user id will appear here.</div>
          </div>
          <div id="supportMessages" class="flex-grow-1 overflow-auto pe-1" style="min-height: 320px;"></div>
          <div id="supportEmptyState" class="text-center text-secondary py-5">Open a user conversation from the left side.</div>
          <form id="supportReplyForm" class="d-flex gap-2 pt-3 border-top mt-3 d-none">
            <input id="supportReplyInput" class="form-control" placeholder="Type a reply" autocomplete="off" />
            <button class="btn btn-success" type="submit">Send</button>
          </form>
        </div>
      </div>
    </div>
  </div>
`;

const listEl = getElement('supportChatList');
const messagesEl = getElement('supportMessages');
const emptyEl = getElement('supportEmptyState');
const headerEl = getElement('supportChatHeader');
const formEl = getElement('supportReplyForm');
const inputEl = getElement('supportReplyInput');

let activeChatId = '';
let chatRows = [];
let unsubscribeMessages = null;
const pendingRead = new Set();

function markActiveChatRead(chat) {
  if (!chat || Number(chat.unreadForAdminCount || 0) <= 0 || pendingRead.has(chat.userId)) return;
  pendingRead.add(chat.userId);
  markSupportChatReadByAdmin(chat.userId).catch(() => {}).finally(() => pendingRead.delete(chat.userId));
}

function loadAvatars(container) {
  for (const wrapper of container.querySelectorAll('[data-photo-user]')) {
    const chat = chatRows.find((row) => row.userId === wrapper.dataset.photoUser);
    if (chat) bindProfilePhoto(wrapper.querySelector('img'), chat.photoCandidates || [chat.userProfileImage], wrapper.querySelector('.support-chat-user-fallback'));
  }
}

function renderChatList() {
  listEl.innerHTML = chatRows.map((chat) => {
    const active = chat.userId === activeChatId;
    const unread = Number(chat.unreadForAdminCount || 0);
    const name = chat.userName || chat.userEmail || 'Unknown user';
    return `
      <button class="list-group-item list-group-item-action border-0 ${active ? 'active' : ''} support-chat-list-item" data-chat-id="${escapeAttribute(chat.userId)}">
        <div class="d-flex justify-content-between gap-2 align-items-center">
          <div class="d-flex align-items-center gap-3 text-start min-w-0">
            ${renderAvatar(chat, active)}
            <div class="min-w-0">
              <div class="fw-semibold text-truncate">${escapeHtml(name)}</div>
            </div>
          </div>
          ${unread ? `<span class="badge rounded-pill text-bg-danger">${unread}</span>` : ''}
        </div>
      </button>
    `;
  }).join('') || '<div class="p-4 text-secondary text-center">No support chats yet.</div>';
  loadAvatars(listEl);
}

function renderMessages(rows) {
  const hasChat = !!activeChatId;
  emptyEl.classList.toggle('d-none', hasChat);
  messagesEl.classList.toggle('d-none', !hasChat);
  formEl.classList.toggle('d-none', !hasChat);
  if (!hasChat) {
    messagesEl.innerHTML = '';
    return;
  }

  messagesEl.innerHTML = rows.map((row) => {
    const mine = row.senderType === 'admin';
    return `
      <div class="d-flex ${mine ? 'justify-content-end' : 'justify-content-start'} mb-3">
        <div class="support-bubble ${mine ? 'support-bubble-admin' : 'support-bubble-user'}">
          <div>${escapeHtml(row.text || '')}</div>
          <div class="small mt-1 opacity-75">${formatDate(row.createdAtClient || row.createdAt)}</div>
        </div>
      </div>
    `;
  }).join('') || '<div class="text-secondary text-center py-5">No messages in this conversation.</div>';
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

let initialReady;
const initialData = new Promise((resolve) => { initialReady = resolve; });

function openChat(chatId) {
  activeChatId = chatId;
  const chat = chatRows.find((item) => item.userId === chatId);
  headerEl.innerHTML = chat ? renderHeader(chat) : '<div class="fw-semibold">Conversation</div>';
  loadAvatars(headerEl);
  renderChatList();
  markActiveChatRead(chat);
  if (unsubscribeMessages) unsubscribeMessages();
  unsubscribeMessages = watchSupportMessages(chatId, (rows) => {
    renderMessages(rows);
    initialReady();
  }, showChatError);
}

const unsubscribeChats = watchSupportChats((rows) => {
  chatRows = rows.filter((row) => row.userId);
  renderChatList();
  if (!chatRows.length) {
    activeChatId = '';
    if (unsubscribeMessages) {
      unsubscribeMessages();
      unsubscribeMessages = null;
    }
    headerEl.innerHTML = `
      <div class="fw-semibold">Select a conversation</div>
      <div class="small text-secondary">User email and user id will appear here.</div>
    `;
    renderMessages([]);
    initialReady();
    return;
  }
  if (!activeChatId && chatRows.length) {
    openChat(chatRows[0].userId);
  } else if (activeChatId && !chatRows.some((row) => row.userId === activeChatId) && chatRows.length) {
    openChat(chatRows[0].userId);
  } else if (activeChatId) {
    const chat = chatRows.find((item) => item.userId === activeChatId);
    if (chat) {
      headerEl.innerHTML = renderHeader(chat);
      loadAvatars(headerEl);
      markActiveChatRead(chat);
    }
  }
}, showChatError);

function showChatError(error) {
  emptyEl.textContent = 'Unable to load chats. Please try again.';
  emptyEl.classList.remove('d-none');
  initialReady();
}

onPageLeave(page, () => {
  initialReady();
  unsubscribeChats();
  if (unsubscribeMessages) unsubscribeMessages();
});

listEl.addEventListener('click', (event) => {
  const button = event.target.closest('[data-chat-id]');
  if (!button) return;
  openChat(button.dataset.chatId);
});

formEl.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!activeChatId) return;
  const text = inputEl.value.trim();
  if (!text) return;
  inputEl.disabled = true;
  try {
    await sendSupportReply(activeChatId, text);
    inputEl.value = '';
  } catch (error) {
    alert(error?.message || 'Reply failed.');
  } finally {
    inputEl.disabled = false;
    inputEl.focus();
  }
});

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function renderHeader(chat) {
  const name = chat.userName || chat.userEmail || 'Unknown user';
  return `
    <div class="d-flex align-items-center gap-3">
      ${renderAvatar(chat, false, true)}
      <div class="min-w-0">
        <div class="fw-semibold text-truncate">${escapeHtml(name)}</div>
        <div class="small text-secondary text-truncate">${escapeHtml(chat.userEmail || '')}</div>
        <div class="small text-secondary text-truncate">User ID: ${escapeHtml(chat.userId || '')}</div>
      </div>
    </div>
  `;
}

function renderAvatar(chat, active = false, header = false) {
  const name = chat.userName || chat.userEmail || 'U';
  const initial = escapeHtml(name.charAt(0).toUpperCase());
  const extraClass = header ? ' header-fallback' : '';
  const fallback = `<div class="support-chat-user-fallback${extraClass}">${initial}</div>`;
  if (!(chat.photoCandidates?.length || chat.userProfileImage)) return fallback;
  return `<span data-photo-user="${escapeAttribute(chat.userId)}" style="width:46px;height:46px;flex-shrink:0">${fallback}<img hidden alt="${escapeAttribute(name)}" class="support-chat-user-avatar" /></span>`;
}

function escapeAttribute(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

await initialData;
return page;
}
