/*
 * Film stage shim (demo/video only): the real extension pages run inside the stage, so chrome.* calls are
 * forwarded to the stage's background stand-in (window.parent.__ext), which uses the extension's own
 * lib/recording.js. SpeechRecognition is replaced so the film's narration lines arrive as final phrases
 * through the panel's real dictation code path. Not used by the installed extension.
 *
 * Voice: the film has no microphone. window.__RT_VOICE = "simulated" tells the panel not to open one; each
 * narrator line (window.__ext.speak) also drives the panel's visualizer, and at Stop the panel asks /api/stt
 * for the scripted demo transcript (provider "simulated", mode "scripted"), built from the narration steps.
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
    tabs: { create: function (o) { return Promise.resolve(window.parent.stage.openInMain(o && o.url)); } },
  };
  // The film's operator is scripted, not a person: say so in what the panel sends.
  window.__RT_OPERATOR = "scripted_playwright";
  // The film's voice is scripted too: no mic, no speech model.
  window.__RT_VOICE = "simulated";
  function FakeRecognition() { this.continuous = false; this.interimResults = false; this.lang = "en-US"; }
  FakeRecognition.prototype.start = function () { var self = this; ext.addRecognizer(self); setTimeout(function () { self.onstart && self.onstart(); }, 50); };
  FakeRecognition.prototype.stop = function () { ext.removeRecognizer(this); this.onend && this.onend(); };
  window.SpeechRecognition = FakeRecognition;
  window.webkitSpeechRecognition = FakeRecognition;

  // When the narrator starts a line, move the panel's visualizer for as long as the line takes to say, then
  // deliver the phrase as before. Re-wrapped on every panel load so it always reaches the current panel.
  var panel = window;
  if (!ext.__speakOriginal) ext.__speakOriginal = ext.speak;
  ext.speak = function (text) {
    try { panel.__rtVoice && panel.__rtVoice.talk(text); } catch (e) { /* panel reloaded */ }
    return ext.__speakOriginal.call(ext, text);
  };
})();
