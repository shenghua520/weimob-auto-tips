/**
 * 复制为 config.local.js 后填写真实值（config.local.js 已在 .gitignore）
 * 也可以全部走环境变量：WEIMOB_BASE / WEIMOB_BOS_ID / WEIMOB_KEY / WEIMOB_VID /
 *                        WEIMOB_ACCOUNT / WEIMOB_PASSWORD / CHROME_PATH
 */
module.exports = {
  BASE: 'https://master.weimob.com',
  BOS_ID: '<BOS_ID>',          // 商户 ID，URL 里 /bos/products/<code>/<这里>/...
  KEY: '<KEY>',                // 同段路径的第二串（门店/组织 key）
  VID: '<VID>',                // 门店/组织 ID，body.basicInfo.vid
  ACCOUNT: '<ACCOUNT>',        // 登录手机号
  PASSWORD: '<PASSWORD>',      // 登录密码
  // playwright 要求的版本可能与本地缓存不一致，显式指向已缓存的 chromium
  CHROME: 'C:/Users/<you>/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
  PROFILE: './.profile',       // 持久化登录态目录
};
