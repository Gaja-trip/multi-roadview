const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload).then(result => {
  if (!result.ok) throw new Error(result.error);
  return result.data;
});

contextBridge.exposeInMainWorld('roadview', {
  desktop: true,
  move: payload => invoke('roadview:move', payload),
  layout: payload => invoke('roadview:layout', payload),
  search: query => invoke('roadview:search', query),
  reload: index => invoke('roadview:reload', index),
  openHistory: index => invoke('roadview:history', index),
  selectDate: payload => invoke('roadview:select-date', payload),
  setLink: payload => invoke('roadview:link', payload),
  openExternal: url => invoke('roadview:external', url),
  copy: text => invoke('roadview:copy', text),
  settings: () => invoke('roadview:settings'),
  saveKey: key => invoke('roadview:save-key', key),
  onPane: callback => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('roadview:pane', handler);
    return () => ipcRenderer.removeListener('roadview:pane', handler);
  },
});
