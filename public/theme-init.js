/* Restore theme before first paint to prevent flash */
(function(){var t=localStorage.getItem('xanic_theme');document.documentElement.setAttribute('data-theme',t==='dark'?'dark':'light')})()