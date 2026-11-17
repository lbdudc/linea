<script setup>
import LanguageSelector from 'src/components/common/LanguageSelector.vue'
import ThemeToggle from 'src/components/common/ThemeToggle.vue'
</script>

<template>
  <div class="login-layout">
    <main class="login-page-container">
      <div class="login-brand">
        <img
          src="/favicon.ico"
          class="login-brand__logo"
          alt="LINEA"
        />
        <h1 class="login-brand__name">LINEA</h1>
        <p class="login-brand__tagline">{{ $t('labels.app_tagline') }}</p>
      </div>

      <router-view />
    </main>

    <footer class="login-footer">
      <div class="login-toolbar">
        <div class="login-toolbar__spacer" />
        <ThemeToggle />
        <LanguageSelector named />
      </div>
    </footer>
  </div>
</template>

<style scoped lang="scss">
.login-layout {
  background:
    radial-gradient(70% 55% at 50% 0%, color-mix(in srgb, var(--p-button-primary-background) 32%, transparent), transparent 72%),
    radial-gradient(45% 45% at 100% 100%, color-mix(in srgb, var(--p-button-primary-background) 22%, transparent), transparent 70%),
    radial-gradient(40% 40% at 0% 100%, color-mix(in srgb, var(--p-button-primary-background) 14%, transparent), transparent 70%),
    var(--p-surface-ground);
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.login-page-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: calc(100vh - 44px);
  padding: 32px 16px;
}

.login-brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 28px;

  &__logo {
    width: 72px;
    height: 72px;
    padding: 14px;
    margin-bottom: 18px;
    border-radius: 20px;
    // the mark is dark navy: it sits on the fixed white brand chip in both themes
    background: var(--p-primary-on-light-background);
    border: 1px solid var(--card-border);
    box-shadow:
      0 8px 24px -8px color-mix(in srgb, var(--p-primary-color) 35%, transparent),
      0 2px 4px rgba(0, 0, 0, 0.06);
  }

  &__name {
    font-family: var(--font-sans);
    font-weight: 600;
    font-size: 28px;
    color: var(--p-text-color);
    margin: 0;
    letter-spacing: 0.18em;
    line-height: 1;
    text-indent: 0.18em;
  }

  &__tagline {
    font-family: var(--font-sans);
    font-size: 13px;
    color: var(--p-text-muted-color);
    margin: 10px 0 0;
    letter-spacing: 0.02em;
  }
}

.login-footer {
  background: transparent;
  box-shadow: none;
}

.login-toolbar {
  display: flex;
  align-items: center;
  min-height: 44px;
  padding: 4px 12px;
  gap: 4px;

  &__spacer { flex: 1; }
}
</style>
