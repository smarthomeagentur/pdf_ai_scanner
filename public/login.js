let lockoutTimer = null;
let remainingSeconds = 0;

function startLockoutCountdown(seconds = 60) {
  const submitBtn = document.querySelector("#loginForm button[type='submit']");
  const pwdInput = document.getElementById("password");
  const err = document.getElementById("errorMsg");

  if (lockoutTimer) clearInterval(lockoutTimer);
  remainingSeconds = seconds;

  if (submitBtn) submitBtn.disabled = true;
  if (pwdInput) {
    pwdInput.disabled = true;
    pwdInput.blur();
  }

  const updateDisplay = () => {
    if (remainingSeconds <= 0) {
      clearInterval(lockoutTimer);
      lockoutTimer = null;
      if (submitBtn) submitBtn.disabled = false;
      if (pwdInput) {
        pwdInput.disabled = false;
        pwdInput.focus();
      }
      if (err) err.innerText = "";
      return;
    }

    if (err) {
      err.innerHTML = `<span class="material-symbols-outlined" style="font-size: 16px; vertical-align: middle; margin-right: 4px;">timer</span>Zu viele Fehlversuche. Bitte warte noch <strong>${remainingSeconds}s</strong>...`;
    }
    remainingSeconds--;
  };

  updateDisplay();
  lockoutTimer = setInterval(updateDisplay, 1000);
}

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (lockoutTimer) return;

  const pwd = document.getElementById("password").value;
  const err = document.getElementById("errorMsg");
  const submitBtn = document.querySelector("#loginForm button[type='submit']");
  if (err) err.innerText = "";

  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerText = "Prüfe...";
  }

  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pwd }),
    });
    const data = await res.json().catch(() => ({}));

    if (res.status === 429) {
      startLockoutCountdown(data.retryAfter || 60);
      return;
    }

    if (data.success) {
      window.location.href = "/";
    } else {
      if (err) err.innerText = data.error || "Login fehlgeschlagen.";
      const pwdInput = document.getElementById("password");
      if (pwdInput) {
        pwdInput.value = "";
        pwdInput.focus();
      }
    }
  } catch (e) {
    if (err) err.innerText = "Verbindungsfehler.";
  } finally {
    if (!lockoutTimer && submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerText = "Anmelden";
    }
  }
});

const togglePassword = document.getElementById("togglePassword");
const passwordInput = document.getElementById("password");

if (togglePassword && passwordInput) {
  togglePassword.addEventListener("click", () => {
    const type = passwordInput.getAttribute("type") === "password" ? "text" : "password";
    passwordInput.setAttribute("type", type);
    togglePassword.innerText = type === "password" ? "visibility" : "visibility_off";
  });
}
