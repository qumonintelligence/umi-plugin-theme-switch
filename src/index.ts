// ref:
// - https://umijs.org/plugin/develop.html
import { IApi } from 'umi';
import { isAbsolute, join } from 'path';
import assert from 'assert';
import globby from 'globby';

export interface UmiPluginThemeSwitchOptions {
  themes: UmiPluginThemeItem[] | string;
  defaultTheme?: string;
  scope?: string;
  autoDetectDarkMode?: {
    enable: boolean;
    darkTheme?: string;
  };
  remember?: boolean;
  attribute?: string;
}

export interface UmiPluginThemeItem {
  name: string;
  variables: UmiPluginCssVariables;
}

export interface UmiPluginCssVariables {
  [K: string]: string;
}

function resolvePath(cwd: string, path: string) {
  return !isAbsolute(path) ? join(cwd, path) : path;
}

export function generateStyles(cssVariables: UmiPluginCssVariables, scope: string) {
  const cssAssign = Object.entries(cssVariables).map(([k, v]) => {
    return `${addCssVariablesPrefix(k)}: ${v};`;
  });
  return `${scope}{${cssAssign.join('')}}`.trim();
}

/**
 * 生成style的cssText
 * @param themes
 * @param attribute
 * @param defaultTheme
 */
export function generateAllStyles(
  themes: UmiPluginThemeItem[],
  scope: string,
  attribute: string,
  defaultTheme: string
) {
  let cssText = '';
  themes.forEach(theme => {
    if (theme.name === defaultTheme) {
      cssText += generateStyles(theme.variables as UmiPluginCssVariables, scope);
    } else {
      cssText += generateStyles(
        theme.variables as UmiPluginCssVariables,
        `${scope}[${attribute}=${theme.name}]`
      );
    }
    cssText += '\n';
  });
  return cssText;
}

/**
 * 强制补齐css变量前面的 `--` 符号
 * @param variable
 */
export function addCssVariablesPrefix(variable: string) {
  return variable.replace(/^[\-]*/, '--');
}

/**
 * filepath => Object
 * @param filepath
 * @param cwd
 */
export function parseFilepathThemes(filepath: string, cwd: string) {
  const path = resolvePath(cwd, filepath);
  return globby.sync('*.{js,json}', { cwd: path }).map(name => {
    const _name = name.substring(0, name.lastIndexOf('.'));
    const fullpath = join(path, name);
    let variables = /\.ts$/.test(name) ? requireTSFile(fullpath) : require(fullpath);
    return {
      name: _name,
      variables: variables,
    } as UmiPluginThemeItem;
  });
}

export function requireTSFile(fullPath: string) {
  // TODO
}

const defaultConfig: Partial<UmiPluginThemeSwitchOptions> = {
  scope: ':root',
  autoDetectDarkMode: null,
  remember: false,
  attribute: 'umi-theme',
};

export default function(api: IApi) {
  api.describe({
    key: 'theme-switch',
    config: {
      default: defaultConfig,
      schema(joi) {
        return joi.object({
          themes: joi.array(),
          scope: joi.string(),
          autoDetectDarkMode: joi.boolean(),
          remember:joi.boolean(),
          attribute: joi.string(),
        });
      },
    },
  })
  let opts = Object.assign({}, defaultConfig, api.userConfig['theme-switch']);

  const { cwd } = api;
  const { themes, defaultTheme, attribute, scope, remember, autoDetectDarkMode } = opts;

  assert(themes, '[umi-plugin-theme-switch]: option "themes" is required');

  let _themes = typeof themes === 'string' ? parseFilepathThemes(themes, cwd) : themes;

  let _defaultTheme = defaultTheme;
  if (!_themes.find(t => t.name === _defaultTheme)) {
    _defaultTheme = _themes[0].name;
  }

  // api.modifyConfig(newOpts => {
  //   opts = Object.assign({}, defaultConfig, newOpts);
  //   api.restartServer();
  // });

  api.addHTMLStyles(() => ({
    type: 'text/css',
    content: generateAllStyles(_themes, scope, attribute, _defaultTheme),
  }));

  api.chainWebpack((config, { webpack }) => {
    config.plugin('theme-config').use(webpack.DefinePlugin, [
      {
        UMI_THEME_ATTRIBUTE: JSON.stringify(attribute),
        UMI_THEME_SCOPE: JSON.stringify(scope),
      },
    ]);
    return config
  });
  // 记住上一次选中的主题
  let detecteLastTheme = '';
  if (remember) {
    // 检测上一次缓存的主题 并当成默认主题设置 避免默认主题覆盖上一次选中的主题
    detecteLastTheme = `__defaultTheme = window.localStorage.getItem('umi_theme') || __defaultTheme`;
  }
  // 默认主题
  api.addEntryCodeAhead(() => `
    ;(function(){
      window['_default_theme'] = ${JSON.stringify(_defaultTheme)};
      var __defaultTheme = ${JSON.stringify(_defaultTheme)};
      if(typeof localStorage !== 'undefined'){
        ${detecteLastTheme}
        window.localStorage.setItem('umi_theme', __defaultTheme);
      }
    })();
  `);

  // 记住上次选择过的主题
  if (remember) {
    api.addEntryCodeAhead(() => `
      ;(function(){
        const theme = typeof localStorage !== 'undefined' ? window.localStorage.getItem('umi_theme') : '';
        if(!theme) return;
        [].forEach.call(document.querySelectorAll(UMI_THEME_SCOPE)||[],e=>{
          e.setAttribute(UMI_THEME_ATTRIBUTE, theme);
        })
      })();
    `);
  }

  // 自动检测暗色主题，如果remember也为true，则只在页面没有设置过theme的情况下才检测
  if (autoDetectDarkMode && autoDetectDarkMode.enable) {
    api.addEntryCodeAhead(() => `
      ;(function(){
        const isBrowserDarkMode = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        if(!isBrowserDarkMode) return;
        const remember = ${remember};
        const theme = typeof localStorage !== 'undefined' ? window.localStorage.getItem('umi_theme') : '';
        if(!remember || (remember && !theme)){
          [].forEach.call(document.querySelectorAll(UMI_THEME_SCOPE)||[],e=>{
            e.setAttribute(UMI_THEME_ATTRIBUTE, "${autoDetectDarkMode.darkTheme || 'dark'}");
          })
        }
      })();
    `);
  }
}
