import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Upload, Send, FileText, MessageCircle, AlertCircle, XCircle, Brain, PlusCircle, MessageSquare, Trash2, LogOut, User, Mic, Copy, Volume2 } from 'lucide-react';
import removeMarkdown from 'remove-markdown';

import { initializeApp } from 'firebase/app';
import {
  getAuth,
  onAuthStateChanged,
  signOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
} from 'firebase/auth';
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  arrayUnion,
  deleteDoc,
} from 'firebase/firestore';

// configuring backend hereee....
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://localhost:8000";

const globalFirebaseConfigString = typeof window !== 'undefined' && typeof window.__firebase_config !== 'undefined' ? window.__firebase_config : null;
const globalAppId = typeof window !== 'undefined' && typeof window.__app_id !== 'undefined' ? window.__app_id : null;

let firebaseConfig;
if (globalFirebaseConfigString) {
  try {
    firebaseConfig = JSON.parse(globalFirebaseConfigString);
  } catch (e) {
    console.error("Failed to parse global __firebase_config:", e);
  }
}

if (!firebaseConfig) {
  console.warn("Global __firebase_config not found or invalid, falling back to .env variables for Firebase.");
  firebaseConfig = {
    apiKey: process.env.REACT_APP_FIREBASE_API_KEY,
    authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID,
    storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.REACT_APP_FIREBASE_APP_ID,
  };
}

const appIdentifierForFirestore = globalAppId || firebaseConfig.projectId || 'default-app-id';

let fbApp;
let db;
let fbAuth;

if (firebaseConfig && firebaseConfig.apiKey && !fbApp) {
  try {
    fbApp = initializeApp(firebaseConfig);
    db = getFirestore(fbApp);
    fbAuth = getAuth(fbApp);
  } catch (e) {
    console.error("Firebase initialization error:", e);
  }
} else if (!firebaseConfig || !firebaseConfig.apiKey) {
  console.error("Firebase configuration is critically missing. Chat history and other Firebase features will NOT work.");
}


const AuthModal = React.memo(({
                                isLoginMode, email, password, authLoading, authError, googleLoading,
                                setEmail, setPassword, setIsLoginMode, setAuthError, handleAuthSubmit, handleGoogleSignIn
                              }) => {
  return (
      <div className="auth-modal-overlay">
        <div className="auth-modal">
          <h2>{isLoginMode ? 'Login' : 'Sign Up'}</h2>
          <form onSubmit={handleAuthSubmit}>
            <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required disabled={authLoading || googleLoading}/>
            <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required disabled={authLoading || googleLoading}/>
            {authError && <div className="auth-error">{authError}</div>}
            <button type="submit" disabled={authLoading || googleLoading}>
              {authLoading ? '...' : (isLoginMode ? 'Login' : 'Sign Up')}
            </button>
          </form>
          <div className="auth-separator">OR</div>
          <button onClick={handleGoogleSignIn} className="google-sign-in-button" disabled={authLoading || googleLoading}>
            {googleLoading ? '...' : (<> <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google icon" className="google-icon" /> Sign {isLoginMode ? 'in' : 'up'} with Google </>)}
          </button>
          <div className="auth-toggle">
            {isLoginMode ? (<p>Don't have an account? <span onClick={() => { setIsLoginMode(false); setAuthError(''); setEmail(''); setPassword(''); }}>Sign Up</span></p>)
                : (<p>Already have an account? <span onClick={() => { setIsLoginMode(true); setAuthError(''); setEmail(''); setPassword(''); }}>Login</span></p>)}
          </div>
        </div>
      </div>
  );
});

function App() {
  const [message, setMessage] = useState('');
  const [chatHistory, setChatHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const chatContainerRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [activeFileContext, setActiveFileContext] = useState(null);
  const fileInputRef = useRef(null);
  const [isChatInitialized, setIsChatInitialized] = useState(false);

  const [userId, setUserId] = useState(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [currentConversationId, setCurrentConversationId] = useState(null);
  const [isSidebarLoading, setIsSidebarLoading] = useState(true);
  const [isDeletingConversation, setIsDeletingConversation] = useState(null);

  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [googleLoading, setGoogleLoading] = useState(false);

  const [isListening, setIsListening] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechError, setSpeechError] = useState('');
  const recognitionRef = useRef(null);
  const currentUtteranceRef = useRef(null);
  const [isProcessingFile, setIsProcessingFile] = useState(false);



  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [chatHistory, isLoading]);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(''), 7000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onstart = () => { setIsListening(true); setSpeechError(''); setMessage(''); };
      recognition.onresult = (event) => {
        const transcript = Array.from(event.results).map(result => result[0]).map(result => result.transcript).join('');
        setMessage(transcript);
        setIsListening(false);
      };
      recognition.onerror = (event) => {
        console.error('Speech Recognition Error:', event.error);
        let msg = `Speech recognition error: ${event.error}`;
        if (event.error === 'not-allowed') msg = 'Microphone access denied. Please allow it in browser settings.';
        if (event.error === 'no-speech') msg = 'No speech detected. Please try again.';
        setSpeechError(msg);
        setIsListening(false);
      };
      recognition.onend = () => setIsListening(false);
      recognitionRef.current = recognition;
    } else {
      setSpeechError('Speech recognition is not supported in this browser.');
    }
    if (!('speechSynthesis' in window)) {
      setSpeechError(prev => prev + (prev ? ' ' : '') + 'Text-to-speech is not supported in this browser.');
    }
    return () => { if (window.speechSynthesis && currentUtteranceRef.current) window.speechSynthesis.cancel(); };
  }, []);


  //firebase authentication
  useEffect(() => {
    if (!fbAuth) {
      setError("Firebase Auth is not initialized. Chat history will be disabled.");
      setIsAuthReady(true);
      setIsSidebarLoading(false);
      return;
    }
    const unsubscribe = onAuthStateChanged(fbAuth, (user) => {
      if (user) {
        setUserId(user.uid);
        setShowAuthModal(false);
        setAuthError(''); setEmail(''); setPassword('');
      } else {
        setUserId(null);
        setShowAuthModal(true);
      }
      setIsAuthReady(true);
      setIsSidebarLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (isAuthReady && userId && db) {
      setIsSidebarLoading(true);
      const conversationsRef = collection(db, 'artifacts', appIdentifierForFirestore, 'users', userId, 'conversations');
      const q = query(conversationsRef);
      const unsubscribe = onSnapshot(q, (snapshot) => {
        let convos = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        convos.sort((a, b) => (b.lastUpdatedAt?.toMillis() || 0) - (a.lastUpdatedAt?.toMillis() || 0));
        setConversations(convos);
        setIsSidebarLoading(false);
      }, (err) => {
        console.error("Error fetching conversations:", err);
        setError(`Failed to load conversations: ${err.message}`);
        setIsSidebarLoading(false);
      });
      return () => unsubscribe();
    } else if (isAuthReady && !userId) {
      setConversations([]);
      setIsSidebarLoading(false);
    }
  }, [isAuthReady, userId]);

  useEffect(() => {
    if (currentConversationId && userId && db) {
      const convoDocRef = doc(db, 'artifacts', appIdentifierForFirestore, 'users', userId, 'conversations', currentConversationId);
      const unsubscribe = onSnapshot(convoDocRef, (docSnap) => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          setChatHistory(data.messages || []);
          setActiveFileContext(data.activeFileContext || null);
          setIsChatInitialized(true);
        } else if (!conversations.some(c => c.id === currentConversationId)) {
          startNewChat();
        }
      }, (err) => {
        console.error(`Error fetching conversation ${currentConversationId}:`, err);
        setError(`Could not load messages: ${err.message}`);
        setIsChatInitialized(true);
      });
      return () => unsubscribe();
    } else if (!currentConversationId) {
      setChatHistory([]);
      setActiveFileContext(null);
      setIsChatInitialized(true);
    }
  }, [currentConversationId, userId, conversations]);



  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setSelectedFile({ name: file.name, type: file.type, size: file.size });
    setIsProcessingFile(true);
    setError('');

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch(`${BACKEND_URL}/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Unknown upload error' }));
        throw new Error(errorData.detail || `File upload failed with status: ${response.status}`);
      }

      const result = await response.json();
      setActiveFileContext({
        name: file.name,
        type: file.type,
        document_id: result.document_id
      });
      setError(`Attached document: ${file.name}`);

    } catch (err) {
      console.error("File upload error:", err);
      setError(`Upload error: ${err.message}`);
      setSelectedFile(null);
    } finally {
      setIsProcessingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };


  const handleSendMessage = async () => {
    if (!isAuthReady || !userId) {
      setError("You must be logged in to chat.");
      return;
    }
    const userQuery = message.trim();
    if (!userQuery) return;

    if (isListening) stopListening();
    if (isSpeaking) stopSpeaking();

    const userMessageForUI = createMessageForFirestore('user', { text: userQuery, file: selectedFile || activeFileContext });

    setChatHistory(prev => [...prev, userMessageForUI]);
    setIsLoading(true);
    setError('');
    setMessage('');

    const documentIdToSend = activeFileContext?.document_id || null;
    let conversationIdToUpdate = currentConversationId;

    try {
      const historyForApi = chatHistory.map(chat => ({ role: chat.role, content: chat.display.text }));

      if (!conversationIdToUpdate) {
        const title = userQuery.substring(0, 40) || activeFileContext?.name?.substring(0, 40) || "New Chat";
        const newConvoRef = await addDoc(collection(db, 'artifacts', appIdentifierForFirestore, 'users', userId, 'conversations'), {
          userId, title, createdAt: serverTimestamp(), lastUpdatedAt: serverTimestamp(),
          messages: [userMessageForUI], activeFileContext: activeFileContext,
        });
        conversationIdToUpdate = newConvoRef.id;
        setCurrentConversationId(conversationIdToUpdate);
      } else {
        await updateDoc(doc(db, 'artifacts', appIdentifierForFirestore, 'users', userId, 'conversations', conversationIdToUpdate), {
          messages: arrayUnion(userMessageForUI), lastUpdatedAt: serverTimestamp(), activeFileContext: activeFileContext,
        });
      }

      const response = await fetch(`${BACKEND_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userQuery, history: historyForApi, document_id: documentIdToSend }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Unknown API error' }));
        throw new Error(errorData.detail || `API Error: ${response.status}`);
      }

      const data = await response.json();
      const botReplyText = data.reply;

      const finalBotMessage = createMessageForFirestore('model', { text: botReplyText, file: null });
      setChatHistory(prev => [...prev, finalBotMessage]);

      await updateDoc(doc(db, 'artifacts', appIdentifierForFirestore, 'users', userId, 'conversations', conversationIdToUpdate), {
        messages: arrayUnion(finalBotMessage), lastUpdatedAt: serverTimestamp(),
      });

      setSelectedFile(null);

    } catch (err) {
      console.error('Error in handleSendMessage:', err);
      const errorText = `❌ Error: ${err.message}`;
      setError(err.message);
      const errorMsg = createMessageForFirestore('model', { text: errorText, file: null });
      errorMsg.isError = true;
      setChatHistory(prev => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };



  const createMessageForFirestore = (role, display) => ({
    role,
    display,
    timestamp: new Date()
  });

  const removeStagedFile = () => {
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const clearActiveFileMemory = async () => {
    const rememberedDocName = activeFileContext?.name;
    setActiveFileContext(null);
    if (rememberedDocName && currentConversationId && userId && db) {
      const clearMessageText = `Okay, I've cleared "${rememberedDocName}" from memory.`;
      const clearMessageEntry = createMessageForFirestore('model', { text: clearMessageText, file: null });
      try {
        const convoDocRef = doc(db, 'artifacts', appIdentifierForFirestore, 'users', userId, 'conversations', currentConversationId);
        await updateDoc(convoDocRef, {
          messages: arrayUnion(clearMessageEntry),
          lastUpdatedAt: serverTimestamp(),
          activeFileContext: null
        });
      } catch (err) {
        console.error("Error clearing memory msg:", err);
        setError("Failed to update conversation.");
      }
    }
  };

  const startNewChat = () => {
    setCurrentConversationId(null); setMessage(''); setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setError(''); setActiveFileContext(null); setIsChatInitialized(false);
    if (isSpeaking) stopSpeaking();
  };

  const loadConversation = useCallback((conversationIdToLoad) => {
    if (currentConversationId === conversationIdToLoad) return;
    setCurrentConversationId(conversationIdToLoad); setMessage('');
    setSelectedFile(null); setIsChatInitialized(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setError(''); if (isSpeaking) stopSpeaking();
  }, [currentConversationId, isSpeaking]);

  const deleteConversation = async (conversationIdToDelete) => {
    if (!userId || !db || isDeletingConversation === conversationIdToDelete) return;
    if (!window.confirm("Delete this conversation permanently?")) return;
    setIsDeletingConversation(conversationIdToDelete);
    try {
      await deleteDoc(doc(db, 'artifacts', appIdentifierForFirestore, 'users', userId, 'conversations', conversationIdToDelete));
      if (currentConversationId === conversationIdToDelete) startNewChat();
    } catch (err) {
      console.error("Error deleting conversation:", err);
      setError(`Failed to delete conversation: ${err.message}`);
    } finally {
      setIsDeletingConversation(null);
    }
  };

  const handleSignOut = async () => {
    if (!fbAuth) return;
    try {
      await signOut(fbAuth);
      setUserId(null); setCurrentConversationId(null); setConversations([]);
      setChatHistory([]); setActiveFileContext(null); setSelectedFile(null);
      setError(''); setShowAuthModal(true); setEmail(''); setPassword('');
      setAuthError(''); setIsLoginMode(true); setIsChatInitialized(false);
      if (isSpeaking) stopSpeaking();
    } catch (error) {
      console.error("Sign out error:", error);
      setError("Failed to sign out: " + error.message);
    }
  };

  const handleAuthSubmit = useCallback(async (e) => {
    e.preventDefault();
    setAuthLoading(true); setAuthError('');
    try {
      if (isLoginMode) await signInWithEmailAndPassword(fbAuth, email, password);
      else await createUserWithEmailAndPassword(fbAuth, email, password);
    } catch (err) {
      const msg = err.message.split('auth/')[1]?.replace(').', '').replace(/-/g, ' ').trim() || err.message;
      setAuthError(msg);
    } finally {
      setAuthLoading(false);
    }
  }, [isLoginMode, email, password, fbAuth]);

  const handleGoogleSignIn = useCallback(async () => {
    if (!fbAuth) { setAuthError("Firebase Auth not initialized."); return; }
    setGoogleLoading(true); setAuthError('');
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(fbAuth, provider);
    } catch (error) {
      const msg = `Google Sign-In failed: ${error.code?.replace('auth/', '').replace(/-/g, ' ').trim() || error.message}`;
      setAuthError(msg);
    } finally {
      setGoogleLoading(false);
    }
  }, [fbAuth]);

  const startListening = () => { if (recognitionRef.current && !isListening) recognitionRef.current.start(); };
  const stopListening = () => { if (recognitionRef.current && isListening) recognitionRef.current.stop(); };

  const speakResponse = (text) => {
    const cleanText = removeMarkdown(text);
    if (!('speechSynthesis' in window) || !cleanText) return;
    if (window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      if (currentUtteranceRef.current?.text === cleanText) { setIsSpeaking(false); return; }
    }
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    window.speechSynthesis.speak(utterance);
    currentUtteranceRef.current = utterance;
  };

  const stopSpeaking = () => { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); setIsSpeaking(false); };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024, i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${['Bytes', 'KB', 'MB', 'GB'][i]}`;
  };

  const handleKeyPress = (e) => { if (e.key === 'Enter' && !e.shiftKey && !isLoading) { e.preventDefault(); handleSendMessage(); }};

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text).then(() => {
    }).catch(err => {
      console.error('Failed to copy text: ', err);
    });
  };


  const SidebarContent = () => (
      <div className="sidebar">
        <button onClick={startNewChat} className="new-chat-button" disabled={!userId || !isAuthReady || isLoading}>
          <PlusCircle size={18} /> New Chat
        </button>
        <div className="conversations-list">
          {isSidebarLoading && <div className="sidebar-loading">Loading chats...</div>}
          {!isSidebarLoading && !conversations.length && userId && <div className="no-conversations">No past chats.</div>}
          {!isSidebarLoading && conversations.map(convo => (
              <div key={convo.id} className={`conversation-item ${convo.id === currentConversationId ? 'active' : ''}`}
                   onClick={() => loadConversation(convo.id)} title={convo.title || 'Chat'}>
                <MessageSquare size={16} className="convo-icon" />
                <span className="convo-title">{convo.title || 'Chat'}</span>
                <button className="delete-convo-button" title="Delete chat" disabled={isDeletingConversation === convo.id}
                        onClick={(e) => { e.stopPropagation(); deleteConversation(convo.id); }}>
                  {isDeletingConversation === convo.id ? <div className="mini-loader"></div> : <Trash2 size={14} />}
                </button>
              </div>
          ))}
        </div>
        {userId && isAuthReady && <button onClick={handleSignOut} className="sign-out-button-sidebar"><LogOut size={16} /> Sign Out</button>}
        {!userId && isAuthReady && <button onClick={() => setShowAuthModal(true)} className="sign-in-button-sidebar"><User size={16} /> Login / Sign Up</button>}
      </div>
  );

  return (
      <div className="app-layout">
        {(fbApp && db) && <SidebarContent />}
        <div className="chatbot-app-container">
          <header className="app-header">
            <div className="header-main-content">
              <MessageCircle size={28} className="header-icon" />
              <div><h1>RAG AI Assistant</h1><p>Powered by Gemini & FastAPI</p></div>
            </div>
            {userId && <span className="user-id-header-display" title={`UID: ${userId}`}>ID: {userId.substring(0, 8)}...</span>}
          </header>

          {activeFileContext && (
              <div className="active-file-context-banner">
                <Brain size={18} className="context-icon" />
                <span>Active: <strong>{activeFileContext.name}</strong></span>
                {activeFileContext.document_id && <span className="vector-status">(Vectorized)</span>}
                <button onClick={clearActiveFileMemory} className="clear-context-button" title="Forget document" disabled={isLoading}><XCircle size={18} /> Forget</button>
              </div>
          )}
          {(error || speechError) && (<div className="error-banner"><AlertCircle size={20} className="error-icon" /><p>{error || speechError}</p></div>)}
          {isProcessingFile && (
              <div className="vectorization-loading">
                <div className="loading-dots"><div></div><div></div><div></div></div>
                Processing document...
              </div>
          )}

          <div className="chat-container" ref={chatContainerRef}>
            {chatHistory.length === 0 && !isLoading && (
                <div className="welcome-message">
                  <MessageCircle size={48} className="welcome-icon" />
                  <p className="welcome-title">Welcome!</p>
                  <p>Ask a question or upload a document to begin.</p>
                </div>
            )}

            {chatHistory.map((chat, idx) => {
              const textToDisplay = removeMarkdown(chat.display.text || '');
              return (
                  <div key={idx} className={`chat-message-wrapper ${chat.role}-message-wrapper`}>
                    <div className={`chat-message ${chat.role} ${chat.isError ? 'error-message' : ''}`}>
                      {chat.role === 'user' && chat.display.file && <div className="file-preview"><FileText size={16} /><div className="file-preview-details"><div className="file-name">Attached: {chat.display.file.name}</div></div></div>}

                      <div className="message-content">
                        {textToDisplay}
                      </div>

                      {chat.role === 'model' && !chat.isError && textToDisplay && (
                          <div className="message-actions">
                            <button onClick={() => speakResponse(textToDisplay)} className={`action-button ${isSpeaking && currentUtteranceRef.current?.text === textToDisplay ? 'speaking' : ''}`}><Volume2 size={16} /></button>
                            <button onClick={() => copyToClipboard(textToDisplay)} className="action-button"><Copy size={16} /></button>
                          </div>
                      )}
                    </div>
                  </div>
              );
            })}

            {isLoading && (
                <div className="chat-message-wrapper model-message-wrapper">
                  <div className="loading-indicator-message">
                    <div className="loading-dots-container">
                      <div className="loading-dot"></div>
                      <div className="loading-dot" style={{ animationDelay: '0.1s' }}></div>
                      <div className="loading-dot" style={{ animationDelay: '0.2s' }}></div>
                    </div>
                  </div>
                </div>
            )}
          </div>

          <div className="chat-input-area">
            <div className="chat-input-area-inner">
              {selectedFile && (
                  <div className="selected-file-preview">
                    <div className="selected-file-info"><FileText size={20} className="file-icon" /><div className="selected-file-details"><span className="file-name" title={selectedFile.name}>{selectedFile.name}</span><div className="file-size">{formatFileSize(selectedFile.size || 0)}</div></div></div>
                    <button type="button" onClick={removeStagedFile} className="remove-file-button" title="Remove file" disabled={isLoading || isProcessingFile}><XCircle size={16} /></button>
                  </div>
              )}
              <div className="chat-input-form">
                <div className="input-wrapper">
                  <textarea value={message} onChange={(e) => setMessage(e.target.value)} onKeyPress={handleKeyPress}
                            placeholder={isListening ? "Listening..." : "ASK Me/ Upload File..."}
                            disabled={isLoading || !isAuthReady || !userId || isListening || isProcessingFile} className="chat-input" rows={1} />
                </div>
                <div className="chat-input-actions">
                  <button type="button" onClick={isListening ? stopListening : startListening} className={`voice-input-button ${isListening ? 'active' : ''}`} title="Voice Input" disabled={isLoading || isProcessingFile}><Mic size={20} className={`mic-icon ${isListening ? 'animate-pulse' : ''}`} /></button>
                  <label className={`upload-button-wrapper ${isLoading || isProcessingFile ? 'disabled' : ''}`} title="Upload File">
                    <Upload size={20} className="upload-icon" />
                    <input ref={fileInputRef} type="file" className="hidden-file-input"
                           accept=".pdf,.txt,.docx"
                           onChange={handleFileUpload} disabled={isLoading || !isAuthReady || !userId || isProcessingFile} />
                  </label>
                  <button type="button" onClick={handleSendMessage} className="send-button" title="Send" disabled={isLoading || !message.trim() || !isAuthReady || !userId || isProcessingFile}><Send size={20} /><span>Send</span></button>
                </div>
              </div>
            </div>
          </div>
        </div>
        {showAuthModal && <AuthModal isLoginMode={isLoginMode} email={email} password={password} authLoading={authLoading} authError={authError} googleLoading={googleLoading} setEmail={setEmail} setPassword={setPassword} setIsLoginMode={setIsLoginMode} setAuthError={setAuthError} handleAuthSubmit={handleAuthSubmit} handleGoogleSignIn={handleGoogleSignIn} />}
      </div>
  );
}

export default App;
