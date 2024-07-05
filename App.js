import React, { useEffect, useState, useRef } from 'react';
import { WebView } from 'react-native-webview';
import Constants from 'expo-constants';
import { StyleSheet, View, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';


Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

async function registerForPushNotificationsAsync() {
  let token;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  }

  if (Device.isDevice) {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      console.log('Failed to get push token for push notification!');
      return;
    }
    token = (await Notifications.getExpoPushTokenAsync({
      projectId: Constants.expoConfig.extra.eas.projectId,
    })).data;
  } else {
    console.log('Must use physical device for Push Notifications');
  }

  return token;
}

async function sendTokenToServer(token, sessionData) {
  try {
    let userId = null;  // 기본값을 null로 설정
    let isGuest = true;

    if (sessionData && sessionData.user && sessionData.user.id) {
      userId = sessionData.user.id;
      isGuest = false;
    }

    const response = await fetch('https://share-push-web.vercel.app/api/pushes/saveToken', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        token,
        deviceInfo: {
          os: Platform.OS,
          model: Device.modelName,
        },
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to save token');
    }

    const data = await response.json();
    console.log(data.message);
  } catch (error) {
    console.error('Error sending token to server:', error);
  }
}

export default function App() {
  const [expoPushToken, setExpoPushToken] = useState('');
  const [sessionData, setSessionData] = useState(null);
  const notificationListener = useRef();
  const responseListener = useRef();
  const webViewRef = useRef(null);

  useEffect(() => {
    registerForPushNotificationsAsync().then(token => {
      setExpoPushToken(token);
      if (token) {
        sendTokenToServer(token, sessionData);
      }
    });

    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      console.log(notification);
      // 여기서 WebView에 알림 정보를 전달할 수 있습니다.
      if (webViewRef.current) {
        webViewRef.current.postMessage(JSON.stringify({
          type: 'NOTIFICATION_RECEIVED',
          notification: notification
        }));
      }
    });

    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      console.log(response);
      // 여기서 WebView에 알림 응답 정보를 전달할 수 있습니다.
      if (webViewRef.current) {
        webViewRef.current.postMessage(JSON.stringify({
          type: 'NOTIFICATION_RESPONSE',
          response: response
        }));
      }
    });

    return () => {
      Notifications.removeNotificationSubscription(notificationListener.current);
      Notifications.removeNotificationSubscription(responseListener.current);
    };
  }, [sessionData]);

  const handleMessage = (event) => {
    const data = JSON.parse(event.nativeEvent.data);
    if (data.type === 'GET_PUSH_TOKEN') {
      webViewRef.current.postMessage(JSON.stringify({
        type: 'PUSH_TOKEN',
        token: expoPushToken
      }));
    } else if (data.type === 'SESSION_UPDATE') {
      setSessionData(data.session);
      if (expoPushToken) {
        sendTokenToServer(expoPushToken, data.session);
      }
    }
  };

  return (
      <View style={styles.container}>
        <WebView
            ref={webViewRef}
            style={styles.webview}
            source={{ uri: 'https://share-push-web.vercel.app/' }}
            onMessage={handleMessage}
            injectedJavaScript={`
          window.addEventListener('message', function(event) {
            if (event.data && event.data.type === 'SESSION_UPDATE') {
              window.ReactNativeWebView.postMessage(JSON.stringify(event.data));
            }
          });
        `}
        />
      </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  webview: {
    flex: 1,
  },
});