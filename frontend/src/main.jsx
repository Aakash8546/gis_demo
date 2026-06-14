import React from 'react';
import ReactDOM from 'react-dom/client';
import * as Cesium from 'cesium';
import App from './App';
import './index.css';

window.Cesium = Cesium;

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);


