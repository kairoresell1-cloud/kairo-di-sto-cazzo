// Shared utilities

const showToast = (message, type = 'success') => {
  const container = document.getElementById('toast-container');
  if(!container) return;
  
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${type === 'success' ? '✅' : '❌'}</span>
    <span>${message}</span>
  `;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
};

const api = async (method, path, body = null) => {
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  
  try {
    const response = await fetch(path, options);
    const contentType = response.headers.get("content-type");
    if (contentType && contentType.indexOf("application/json") !== -1) {
      return await response.json();
    }
    return { error: 'Invalid response from server' };
  } catch (error) {
    return { error: 'Network error occurred' };
  }
};

const checkAuth = async (redirectOnFail = true) => {
  try {
    const response = await fetch('/api/me');
    if (response.status === 401) {
      if (redirectOnFail) {
        window.location.href = '/auth/login';
      }
      return null;
    }
    if (response.ok) {
      const user = await response.json();
      return user;
    }
  } catch (e) {
    console.error(e);
  }
  if (redirectOnFail) {
    window.location.href = '/auth/login';
  }
  return null;
};

const requireAdmin = async () => {
  const user = await checkAuth(true);
  if (user && !user.is_admin) {
    window.location.href = '/static/dashboard.html';
    return null;
  }
  return user;
};

const copyToClipboard = async (text) => {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      showToast('Link copiato negli appunti! 📋', 'success');
      return;
    }
    // Fallback for mobile Safari/Chrome or HTTP environments
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-999999px";
    textArea.style.top = "-999999px";
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand('copy');
    textArea.remove();
    if (successful) {
      showToast('Link copiato negli appunti! 📋', 'success');
    } else {
      showToast('Seleziona e copia il testo manualmente', 'error');
    }
  } catch (err) {
    showToast('Link copiato!', 'success');
  }
};

