document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const pwd = document.getElementById("password").value;
  const err = document.getElementById("errorMsg");
  err.innerText = "";

  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pwd }),
    });
    const data = await res.json();

    if (data.success) {
      window.location.href = "/";
    } else {
      err.innerText = data.error || "Login fehlgeschlagen.";
    }
  } catch (e) {
    err.innerText = "Verbindungsfehler.";
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
