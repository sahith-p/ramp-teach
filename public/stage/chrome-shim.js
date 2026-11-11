/*
 * Film stage shim (demo/video only): the real extension pages run inside the stage, so chrome.* calls are
 * forwarded to the stage's background stand-in (window.parent.__ext), which uses the extension's own
 * lib/recording.js. SpeechRecognition is replaced so the film's narration lines arrive as final phrases
 * through the panel's real dictation code path. Not used by the installed extension.
 */
(function () {
  var ext = window.parent && window.parent.__ext;
  if (!ext) return;
  window.chrome = {
    runtime: { sendMessage: function (msg) { return Promise.resolve(ext.handle(msg)); } },
    storage: {
      local: { get: function (keys) { return Promise.resolve(ext.get(keys)); }, set: function () { return Promise.resolve(); } },
      onChanged: { addListener: function (fn) { ext.listen(fn); } },
    },
    downloads: { download: function () { return Promise.resolve(1); } },
  };
  function FakeRecognition() { this.continuous = false; this.interimResults = false; this.lang = "en-US"; }
  FakeRecognition.prototype.start = function () { var self = this; ext.addRecognizer(self); setTimeout(function () { self.onstart && self.onstart(); }, 50); };
  FakeRecognition.prototype.stop = function () { ext.removeRecognizer(this); this.onend && this.onend(); };
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;
})();
