import React from "react";
import { NavigationContainer, useNavigationContainerRef } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Ionicons } from "@expo/vector-icons";

import HomeScreen from "../screens/HomeScreen";
import RecordScreen from "../screens/RecordScreen";
import FeedScreen from "../screens/FeedScreen";
import ProfileScreen from "../screens/ProfileScreen";
import TextAnswerScreen from "../screens/TextAnswerScreen";
import AudioAnswerScreen from "../screens/AudioAnswerScreen";
import DeepAnswerScreen from "../screens/DeepAnswerScreen";
import RemixRecordScreen from "../screens/RemixRecordScreen";
import AuthScreen from "../screens/AuthScreen";
import { apiContract } from "../contracts/api";
import { navigationIntegration } from "../services/observability";
import { useAuth } from "../context/AuthContext";

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName: keyof typeof Ionicons.glyphMap = "home";

          if (route.name === "Home") iconName = focused ? "home" : "home-outline";
          else if (route.name === "Record") iconName = focused ? "radio-button-on" : "radio-button-off";
          else if (route.name === "Feed") iconName = focused ? "play-circle" : "play-circle-outline";
          else if (route.name === "Profile") iconName = focused ? "person" : "person-outline";

          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: "#FF3366",
        tabBarInactiveTintColor: "#888",
        tabBarStyle: {
          backgroundColor: "#0A0A0A",
          borderTopColor: "#1A1A2E",
          borderTopWidth: 1,
          height: 90,
          paddingBottom: 30,
          paddingTop: 10,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
        },
        headerShown: false,
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen
        name="Record"
        component={RecordScreen}
        options={{
          tabBarLabel: "5 SEK",
          tabBarIconStyle: { transform: [{ scale: 1.3 }] },
        }}
      />
      <Tab.Screen name="Feed" component={FeedScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  const { user } = useAuth();
  const navigationRef = useNavigationContainerRef();
  const linking: any = {
    prefixes: [
      "five-second://",
      "https://5sek.app",
      "https://app.5sek.local",
    ] as string[],
    config: {
      screens: {
        Main: {
          screens: {
            Home: "home",
            Record: "record",
            Feed: "feed",
            Profile: "profile",
          },
        },
        // Deep link for shared answers (viral loop)
        DeepAnswer: "answer/:answerId",
        // Alternate path: /a/:answerId (short URL)
        DeepAnswer2: "a/:answerId",
        TextAnswer: "text-answer",
        AudioAnswer: "audio-answer",
        // Remix chain deep link
        RemixRecord: "remix/:parentAnswerId",
      },
    },
    // 🔥 Always enabled — critical for growth loop
    enabled: true,
  };

  return (
    <NavigationContainer
      linking={linking}
      ref={navigationRef}
      onReady={() => {
        navigationIntegration.registerNavigationContainer(navigationRef);
      }}
    >
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {user ? (
          <>
            <Stack.Screen name="Main" component={MainTabs} />
            <Stack.Screen name="TextAnswer" component={TextAnswerScreen} />
            <Stack.Screen name="AudioAnswer" component={AudioAnswerScreen} />
            <Stack.Screen name="DeepAnswer" component={DeepAnswerScreen} />
            <Stack.Screen name="DeepAnswer2" component={DeepAnswerScreen} />
            <Stack.Screen
              name="RemixRecord"
              component={RemixRecordScreen}
              options={{ animation: "slide_from_bottom" }}
            />
          </>
        ) : (
          <Stack.Screen name="Auth" component={AuthScreen} />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
