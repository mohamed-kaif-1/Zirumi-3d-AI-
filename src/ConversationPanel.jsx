import { useEffect, useRef, useState } from 'react';
import { getCharacterPersonality } from './characterPersonalities.js';
import Icon from './Icon.jsx';

export function userNotice(message) {
  if (/ELEVENLABS_API_KEY/.test(message)) return /fallback/i.test(message) ? 'ElevenLabs isn’t connected. Using the configured browser voice.' : 'ElevenLabs isn’t connected. You can keep chatting with text.';
  if (/(?:XAI|GROQ)_API_KEY/.test(message)) return 'The conversation service isn’t connected. Try again once it is available.';
  return message;
}

export default function ConversationPanel({ character, currentAvatar, messages, scrollRef, echo, liveText, thinking, processing, captureBusy, playing, starting, listening, error, draft, setDraft, sendTyped, toggleMic, voiceControls, chatExpanded, setChatExpanded, inputRef, reducedMotion }) {
  const [copied, setCopied] = useState(null);
  const [copyError, setCopyError] = useState('');
  const copyTimer = useRef(null);
  useEffect(() => () => clearTimeout(copyTimer.current), []);
  async function copy(message) {
    try { await navigator.clipboard.writeText(message.text); setCopied(message.id); setCopyError(''); clearTimeout(copyTimer.current); copyTimer.current = setTimeout(() => setCopied(null), 2000); }
    catch { setCopyError('Copy unavailable. Select the response to copy it.'); }
  }
  function prompt(text) { setDraft(text); setChatExpanded(true); inputRef.current?.focus(); }
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: reducedMotion ? 'auto' : 'smooth' }); }, [messages, liveText, thinking, processing, error, chatExpanded, reducedMotion, scrollRef]);
  return <section className={`chat-panel ${chatExpanded ? 'chat-expanded' : ''}`} aria-label={`Conversation with ${currentAvatar.name}`}>
    <header className="chat-head">
      <button type="button" className="conversation-toggle" onClick={() => setChatExpanded(!chatExpanded)} aria-expanded={chatExpanded} aria-controls="conversation-log"><span className="chat-identity"><img src={currentAvatar.thumbnailUrl || '/avatars/default.png'} alt="" /><span><strong>{currentAvatar.name}</strong><small>Your conversation</small></span></span><Icon name="chevron" className="chat-chevron" /></button>
      <button type="button" className="icon-button" aria-label="Clear conversation" title="Clear conversation" onClick={() => { echo.clear(); setDraft(''); setCopyError(''); }} disabled={!messages.length && !error && !captureBusy && !playing && !thinking}><Icon name="trash" size={17} /></button>
    </header>
    <div id="conversation-log" className="chat-log" ref={scrollRef} role="log" aria-live="polite" aria-relevant="additions text">
      {!messages.length && !liveText && !thinking && <div className="conversation-empty">
        <div className="empty-symbol"><Icon name="sparkle" size={25} /></div><span className="eyebrow">HELLO, YOU.</span><h2>{character.greeting}</h2><p>What’s on your mind?</p>
        <div className="conversation-prompts">{character.prompts.map(text => <button type="button" key={text} onClick={() => prompt(text)} disabled={captureBusy}><span>{text}</span><Icon name="arrow" size={14} /></button>)}</div>
      </div>}
      {messages.map(message => {
        const sender = getCharacterPersonality(message.avatarId);
        return <article className={`message message-${message.role}`} key={message.id}>
          <div className="sender">{message.role === 'assistant' ? <><span style={{ background: sender.accent }} className="sender-dot" />{sender.name}</> : 'You'}</div>
          <p>{message.text}</p>
          {message.status === 'failed' && <span className="message-meta">Reply failed. Please try again.</span>}
          {message.status === 'cancelled' && <span className="message-meta">Reply cancelled.</span>}
          {message.role === 'assistant' && <div className="message-actions"><button type="button" className="play-reply" onClick={() => echo.playReply(message.id)} disabled={captureBusy || thinking || !echo.speech.supported} aria-label={`Play ${sender.name} response`} title="Play response"><Icon name="volume" size={15} /></button><button type="button" className="copy-reply" onClick={() => copy(message)} aria-label="Copy response" title={copied === message.id ? 'Copied' : 'Copy response'}><Icon name={copied === message.id ? 'check' : 'copy'} size={14} /></button>{copied === message.id && <span role="status">Copied</span>}</div>}
        </article>;
      })}
      {liveText && <div className="interim-message">{liveText}<span className="cursor" aria-hidden="true">|</span></div>}
      {(processing || thinking) && <div className="thinking-indicator" role="status"><span className="thinking-dots" aria-hidden="true"><i /><i /><i /></span>{processing ? 'Listening to your words…' : `${currentAvatar.name} is thinking…`}<button type="button" onClick={processing ? echo.cancelRecording : echo.cancelRequest} className="text-button">Cancel</button></div>}
      {echo.voice.notice && <p className="voice-notice" role="status">{userNotice(echo.voice.notice)}</p>}
      {(echo.speech.notice || echo.speech.analysisNotice) && <p className="voice-notice" role="status">{userNotice(echo.speech.notice || echo.speech.analysisNotice)}</p>}
      {error && <div role="alert" className="error-message"><p>{userNotice(error)}</p><button type="button" className="text-button" disabled={thinking || captureBusy || playing} onClick={() => { if (echo.error) echo.retry(); else if (echo.voice.error) toggleMic(); else if (echo.speech.error) echo.previewVoice(); }}>Try again <Icon name="reset" size={13} /></button></div>}
      {copyError && <p role="status" className="voice-notice">{copyError}</p>}
    </div>
    <footer className="chat-bottom">
      {playing && <div className="playback-row"><span><i className="playback-dot" />{echo.speech.status === 'starting' ? 'Preparing voice…' : `${currentAvatar.name} is speaking`}</span><button type="button" className="stop-speaking" onClick={echo.stopSpeaking}><Icon name="stop" size={12} />Stop Speaking</button></div>}
      {voiceControls}
      <div className="input-row">
        <button className={`mic-btn ${listening || starting ? 'active' : ''}`} type="button" onClick={() => { if (!listening && !starting) setChatExpanded(true); toggleMic(); }} aria-label={listening || starting ? 'Stop listening' : 'Start speaking'} aria-pressed={listening || starting} disabled={processing || thinking || playing} title={listening || starting ? 'Stop listening' : 'Start speaking'}><Icon name={listening ? 'stop' : 'mic'} size={21} /></button>
        <form className="text-form" onSubmit={sendTyped}><input id="conversation-input" ref={inputRef} value={draft} onChange={event => setDraft(event.target.value)} onFocus={() => setChatExpanded(true)} placeholder={`Message ${currentAvatar.name}…`} aria-label="Message ZIRUMI" maxLength={4000} disabled={captureBusy || thinking} /><button type="submit" disabled={!draft.trim() || captureBusy || thinking} aria-label="Send message" title="Send message"><Icon name="send" size={18} /></button></form>
      </div>
      <span className="composer-hint"><Icon name="shield" size={11} />Your mic is off until you choose to speak.</span>
    </footer>
  </section>;
}
