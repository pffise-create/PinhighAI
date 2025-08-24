import React, { useState } from 'react';
import { Home, MessageCircle, BarChart3, Video, User, Camera, Send, TrendingUp, Play, Settings, Target, Bell } from 'lucide-react';

const GolfUIOptionsDemo = () => {
  const [selectedOption, setSelectedOption] = useState(1);
  const [activeTab, setActiveTab] = useState('chat');

  // Option 1: Minimalist Coaching Journey
  const option1Theme = {
    primary: '#1B4332',
    accent: '#FF6B35',
    background: '#FFFFFF',
    surface: '#FFFFFF',
    text: '#1A1A1A',
    textSecondary: '#4A5568',
    textLight: '#718096',
    success: '#047857',
    border: '#E2E8F0'
  };

  // Option 2: Intelligent Dashboard
  const option2Theme = {
    primary: '#1B4332',
    accent: '#3B82F6',
    background: '#FAFAFA',
    surface: '#FFFFFF',
    text: '#1A202C',
    textSecondary: '#4A5568',
    dataSuccess: '#059669',
    dataWarning: '#F59E0B',
    dataInfo: '#3B82F6',
    border: '#E2E8F0'
  };

  // Option 3: AI Coach Companion
  const option3Theme = {
    primary: '#1B4332',
    accent: '#805AD5',
    background: '#F7FAFC',
    surface: '#FFFFFF',
    text: '#2D3748',
    coachMessage: '#F7FAFC',
    userMessage: '#1B4332',
    coachAccent: '#805AD5',
    border: '#E2E8F0'
  };

  const getCurrentTheme = () => {
    switch(selectedOption) {
      case 1: return option1Theme;
      case 2: return option2Theme;
      case 3: return option3Theme;
      default: return option1Theme;
    }
  };

  const theme = getCurrentTheme();

  // Tab Bar Component
  const TabBar = () => {
    const tabs = [
      { id: 'chat', icon: MessageCircle, label: 'Chat' },
      { id: 'summary', icon: BarChart3, label: 'Summary' },
      { id: 'videos', icon: Video, label: 'Videos' },
      { id: 'profile', icon: User, label: 'Profile' }
    ];

    return (
      <div className="flex bg-white border-t-2 px-4 py-2" style={{ borderTopColor: theme.border }}>
        {tabs.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className="flex-1 flex flex-col items-center py-3 px-2 rounded-lg transition-colors"
            style={{
              color: activeTab === id ? theme.primary : theme.textLight,
              backgroundColor: activeTab === id ? theme.primary + '10' : 'transparent'
            }}
          >
            <Icon size={selectedOption === 3 ? 26 : 24} strokeWidth={2} />
            <span className="text-xs font-semibold mt-1">{label}</span>
            {selectedOption === 3 && activeTab === id && (
              <div className="w-1 h-1 rounded-full mt-1" style={{ backgroundColor: theme.accent }}></div>
            )}
          </button>
        ))}
      </div>
    );
  };

  // Chat Screen Components
  const ChatScreen = () => {
    if (selectedOption === 1) {
      return (
        <div className="flex flex-col h-full" style={{ backgroundColor: theme.background }}>
          <div className="p-6 bg-white border-b" style={{ borderColor: theme.border }}>
            <h1 className="text-2xl font-bold" style={{ color: theme.primary, fontFamily: 'Inter' }}>
              Session #12
            </h1>
            <p className="text-base mt-1" style={{ color: theme.textSecondary }}>
              Working on: Weight Transfer
            </p>
            <div className="w-full h-1 bg-gray-200 rounded mt-3">
              <div className="h-1 rounded" style={{ backgroundColor: theme.accent, width: '75%' }}></div>
            </div>
          </div>
          
          <div className="flex-1 p-4 space-y-4">
            <div className="bg-gray-50 p-4 rounded-2xl max-w-xs">
              <p className="text-lg leading-relaxed" style={{ color: theme.text, fontFamily: 'Inter' }}>
                Great swing! I can see you're really focusing on that weight shift timing we discussed.
              </p>
            </div>
            
            <div className="self-end bg-white p-4 rounded-2xl max-w-xs ml-auto border" 
                 style={{ backgroundColor: theme.primary, color: 'white', borderColor: theme.border }}>
              <p className="text-lg">
                Thanks! It felt much more solid. What should I work on next?
              </p>
            </div>
          </div>

          <div className="p-4 bg-white border-t" style={{ borderColor: theme.border }}>
            <div className="flex space-x-3">
              <input
                placeholder="Ask your coach anything..."
                className="flex-1 p-4 border-2 rounded-full text-lg"
                style={{ borderColor: theme.border, fontFamily: 'Inter' }}
              />
              <button className="px-6 py-4 rounded-full text-white font-semibold"
                      style={{ backgroundColor: theme.accent }}>
                <Send size={20} />
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (selectedOption === 2) {
      return (
        <div className="flex h-full" style={{ backgroundColor: theme.background }}>
          {/* Chat Area */}
          <div className="flex-1 flex flex-col">
            <div className="p-6 bg-white border-b" style={{ borderColor: theme.border }}>
              <h1 className="text-2xl font-bold" style={{ color: theme.primary }}>
                Coaching Session
              </h1>
              <div className="flex items-center space-x-4 mt-2">
                <span className="px-3 py-1 rounded-full text-sm font-medium"
                      style={{ backgroundColor: theme.dataInfo + '20', color: theme.dataInfo }}>
                  Weight Transfer Focus
                </span>
                <span className="px-3 py-1 rounded-full text-sm font-medium"
                      style={{ backgroundColor: theme.dataSuccess + '20', color: theme.dataSuccess }}>
                  Improving
                </span>
              </div>
            </div>
            
            <div className="flex-1 p-4">
              {/* Chat messages */}
            </div>
          </div>

          {/* Context Sidebar */}
          <div className="w-80 bg-white border-l p-6" style={{ borderColor: theme.border }}>
            <h3 className="text-lg font-bold mb-4" style={{ color: theme.primary }}>Session Context</h3>
            
            <div className="space-y-4">
              <div className="p-4 rounded-lg" style={{ backgroundColor: theme.background }}>
                <h4 className="font-semibold mb-2">Current Focus</h4>
                <p className="text-sm" style={{ color: theme.textSecondary }}>
                  Weight transfer timing in transition
                </p>
              </div>
              
              <div className="p-4 rounded-lg" style={{ backgroundColor: theme.background }}>
                <h4 className="font-semibold mb-2">Recent Progress</h4>
                <div className="flex items-center space-x-2">
                  <TrendingUp size={16} style={{ color: theme.dataSuccess }} />
                  <span className="text-sm">Setup consistency: +15%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (selectedOption === 3) {
      return (
        <div className="flex flex-col h-full" style={{ backgroundColor: theme.background }}>
          <div className="p-6 bg-white border-b" style={{ borderColor: theme.border }}>
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold" style={{ color: theme.primary }}>
                  Your Coach
                </h1>
                <p className="text-base mt-1" style={{ color: theme.textSecondary }}>
                  Session #12 • Focused on weight transfer
                </p>
              </div>
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: theme.accent }}></div>
            </div>
          </div>
          
          <div className="flex-1 p-4 space-y-4">
            <div className="bg-white p-5 rounded-2xl border-l-4 shadow-sm" 
                 style={{ borderColor: theme.accent }}>
              <div className="flex items-center space-x-2 mb-3">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: theme.accent }}></div>
                <span className="text-sm font-medium" style={{ color: theme.accent }}>
                  Your Coach
                </span>
              </div>
              <p className="text-lg leading-relaxed" style={{ color: theme.text }}>
                Good morning! I watched your latest swing video and I'm excited to tell you about the progress I'm seeing with your weight transfer. Ready to dive in?
              </p>
            </div>
            
            <div className="flex justify-end">
              <div className="p-5 rounded-2xl max-w-sm text-white shadow-sm"
                   style={{ backgroundColor: theme.primary }}>
                <p className="text-lg">
                  Yes! I felt like something clicked yesterday. What did you notice?
                </p>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border-l-4 shadow-sm" 
                 style={{ borderColor: theme.accent }}>
              <div className="flex items-center space-x-2 mb-3">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: theme.accent }}></div>
                <span className="text-sm font-medium" style={{ color: theme.accent }}>
                  Your Coach
                </span>
              </div>
              <p className="text-lg leading-relaxed" style={{ color: theme.text }}>
                That's exactly what I hoped you'd say! Your weight shift timing has improved by 23% since our last session. Let me show you the specific moment...
              </p>
            </div>
          </div>

          <div className="p-4 bg-white border-t" style={{ borderColor: theme.border }}>
            <div className="flex space-x-3 items-end">
              <button className="p-3 rounded-full" style={{ backgroundColor: theme.accent + '20' }}>
                <Camera size={20} style={{ color: theme.accent }} />
              </button>
              <input
                placeholder="Ask your coach anything..."
                className="flex-1 p-4 border-2 rounded-full text-lg"
                style={{ borderColor: theme.border }}
              />
              <button className="px-6 py-4 rounded-full text-white font-semibold"
                      style={{ backgroundColor: theme.accent }}>
                <Send size={18} />
              </button>
            </div>
          </div>
        </div>
      );
    }
  };

  // Summary Screen Component
  const SummaryScreen = () => {
    if (selectedOption === 1) {
      return (
        <div className="h-full" style={{ backgroundColor: theme.background }}>
          <div className="p-6 bg-white">
            <h1 className="text-3xl font-bold" style={{ color: theme.primary, fontFamily: 'Inter' }}>
              Your Journey
            </h1>
            <p className="text-lg mt-2" style={{ color: theme.textSecondary }}>
              12 coaching sessions completed
            </p>
          </div>

          <div className="p-6 space-y-6">
            {/* Progress Card */}
            <div className="bg-white p-6 rounded-2xl">
              <h2 className="text-xl font-bold mb-4" style={{ color: theme.primary }}>
                Current Focus
              </h2>
              <div className="p-4 rounded-xl" style={{ backgroundColor: theme.accent + '10' }}>
                <h3 className="text-lg font-semibold" style={{ color: theme.accent }}>
                  Weight Transfer Timing
                </h3>
                <p className="mt-2" style={{ color: theme.textSecondary }}>
                  Making great progress! 75% consistency improvement
                </p>
              </div>
            </div>

            {/* Achievements */}
            <div className="bg-white p-6 rounded-2xl">
              <h2 className="text-xl font-bold mb-4" style={{ color: theme.primary }}>
                Recent Breakthroughs
              </h2>
              <div className="space-y-3">
                <div className="flex items-center space-x-3">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: theme.success }}></div>
                  <span className="text-base">Setup consistency mastered</span>
                </div>
                <div className="flex items-center space-x-3">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: theme.success }}></div>
                  <span className="text-base">Tempo rhythm improved</span>
                </div>
              </div>
            </div>

            {/* Continue Coaching CTA */}
            <button className="w-full p-4 rounded-2xl text-white text-xl font-bold"
                    style={{ backgroundColor: theme.accent }}>
              Continue Coaching Session
            </button>
          </div>
        </div>
      );
    }

    if (selectedOption === 2) {
      return (
        <div className="h-full" style={{ backgroundColor: theme.background }}>
          <div className="p-6 bg-white">
            <h1 className="text-2xl font-bold" style={{ color: theme.primary }}>
              Coaching Dashboard
            </h1>
            <p className="text-base mt-1" style={{ color: theme.textSecondary }}>
              AI-powered insights from 12 sessions
            </p>
          </div>

          <div className="p-6 space-y-4">
            {/* Metrics Grid */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white p-4 rounded-xl">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-2xl font-bold" style={{ color: theme.dataSuccess }}>85%</p>
                    <p className="text-sm" style={{ color: theme.textSecondary }}>Setup Score</p>
                  </div>
                  <TrendingUp size={24} style={{ color: theme.dataSuccess }} />
                </div>
              </div>
              
              <div className="bg-white p-4 rounded-xl">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-2xl font-bold" style={{ color: theme.dataWarning }}>72%</p>
                    <p className="text-sm" style={{ color: theme.textSecondary }}>Weight Shift</p>
                  </div>
                  <Target size={24} style={{ color: theme.dataWarning }} />
                </div>
              </div>
            </div>

            {/* AI Insights */}
            <div className="bg-white p-6 rounded-xl">
              <h2 className="text-lg font-bold mb-3" style={{ color: theme.primary }}>
                AI Coaching Insights
              </h2>
              <div className="space-y-3">
                <div className="p-3 rounded-lg" style={{ backgroundColor: theme.dataInfo + '10' }}>
                  <p className="text-sm font-medium" style={{ color: theme.dataInfo }}>
                    Your weight transfer has improved 23% over the last 3 sessions
                  </p>
                </div>
                <div className="p-3 rounded-lg" style={{ backgroundColor: theme.dataWarning + '10' }}>
                  <p className="text-sm font-medium" style={{ color: theme.dataWarning }}>
                    Focus on hip rotation timing for next breakthrough
                  </p>
                </div>
              </div>
            </div>

            {/* Smart Recommendations */}
            <div className="bg-white p-6 rounded-xl">
              <h2 className="text-lg font-bold mb-3" style={{ color: theme.primary }}>
                Today's Recommendation
              </h2>
              <p className="text-base mb-4" style={{ color: theme.textSecondary }}>
                Based on weather and your recent progress, work on tempo drills at the range.
              </p>
              <button className="px-4 py-2 rounded-lg text-white font-medium"
                      style={{ backgroundColor: theme.accent }}>
                View Practice Plan
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (selectedOption === 3) {
      return (
        <div className="h-full" style={{ backgroundColor: theme.background }}>
          <div className="p-6 bg-white">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-bold" style={{ color: theme.primary }}>
                  Your Progress
                </h1>
                <p className="text-base mt-1" style={{ color: theme.textSecondary }}>
                  Coach's assessment & insights
                </p>
              </div>
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: theme.accent }}></div>
            </div>
          </div>

          <div className="p-6 space-y-6">
            {/* Coach's Note */}
            <div className="bg-white p-6 rounded-2xl border-l-4" style={{ borderColor: theme.accent }}>
              <h2 className="text-lg font-bold mb-3" style={{ color: theme.primary }}>
                Coach's Notes
              </h2>
              <p className="text-base leading-relaxed" style={{ color: theme.text }}>
                "I'm really proud of your progress! Your weight transfer work is paying off. I can see you're starting to trust the movement. Let's keep building on this foundation."
              </p>
            </div>

            {/* Progress Story */}
            <div className="bg-white p-6 rounded-2xl">
              <h2 className="text-lg font-bold mb-4" style={{ color: theme.primary }}>
                Your Coaching Journey
              </h2>
              
              <div className="space-y-4">
                <div className="flex items-start space-x-4">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs text-white font-bold"
                       style={{ backgroundColor: theme.success }}>
                    ✓
                  </div>
                  <div>
                    <p className="font-medium">Setup Foundation</p>
                    <p className="text-sm text-gray-600">Mastered in 3 sessions</p>
                  </div>
                </div>
                
                <div className="flex items-start space-x-4">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs text-white font-bold"
                       style={{ backgroundColor: theme.accent }}>
                    →
                  </div>
                  <div>
                    <p className="font-medium">Weight Transfer</p>
                    <p className="text-sm text-gray-600">Current focus - great progress!</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Next Session Preview */}
            <div className="bg-white p-6 rounded-2xl" 
                 style={{ backgroundColor: theme.accent + '10' }}>
              <h2 className="text-lg font-bold mb-3" style={{ color: theme.accent }}>
                Up Next in Your Coaching
              </h2>
              <p className="text-base" style={{ color: theme.text }}>
                Ready to add some tempo work to solidify your weight transfer? I have some great drills lined up for our next session!
              </p>
              <button className="mt-4 px-4 py-2 rounded-lg text-white font-medium"
                      style={{ backgroundColor: theme.accent }}>
                Let's Do It!
              </button>
            </div>
          </div>
        </div>
      );
    }
  };

  // Videos Screen Component
  const VideosScreen = () => (
    <div className="h-full" style={{ backgroundColor: theme.background }}>
      <div className="p-6 bg-white">
        <h1 className="text-2xl font-bold" style={{ color: theme.primary }}>
          {selectedOption === 1 ? 'Video Library' : 
           selectedOption === 2 ? 'Smart Video Analysis' : 
           'Coaching Insights'}
        </h1>
        <p className="text-base mt-1" style={{ color: theme.textSecondary }}>
          {selectedOption === 1 ? '8 swing analyses' :
           selectedOption === 2 ? 'AI-organized by coaching focus' :
           'Your swing progress with coaching insights'}
        </p>
      </div>

      <div className="p-6 space-y-4">
        {/* Video Item */}
        <div className="bg-white p-4 rounded-xl">
          <div className="flex space-x-4">
            <div className="w-20 h-20 bg-gray-200 rounded-lg flex items-center justify-center">
              <Play size={24} style={{ color: theme.textSecondary }} />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-base">
                {selectedOption === 1 ? 'Session 12 - Driver' :
                 selectedOption === 2 ? 'Weight Transfer Focus #3' :
                 'Your Best Weight Shift Yet!'}
              </h3>
              <p className="text-sm mt-1" style={{ color: theme.textSecondary }}>
                {selectedOption === 1 ? 'August 20, 2025' :
                 selectedOption === 2 ? 'Coaching Theme: Weight Transfer • Score: 8.2' :
                 'Coaching Note: "This is the breakthrough moment!"'}
              </p>
              {selectedOption === 2 && (
                <div className="flex space-x-2 mt-2">
                  <span className="px-2 py-1 rounded text-xs"
                        style={{ backgroundColor: theme.dataSuccess + '20', color: theme.dataSuccess }}>
                    Improved
                  </span>
                  <span className="px-2 py-1 rounded text-xs"
                        style={{ backgroundColor: theme.dataInfo + '20', color: theme.dataInfo }}>
                    Weight Transfer
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* More video items would go here */}
      </div>
    </div>
  );

  // Profile Screen Component
  const ProfileScreen = () => (
    <div className="h-full" style={{ backgroundColor: theme.background }}>
      <div className="p-6 bg-white">
        <div className="flex items-center space-x-4">
          <div className="w-16 h-16 bg-gray-300 rounded-full flex items-center justify-center">
            <User size={24} style={{ color: theme.textSecondary }} />
          </div>
          <div>
            <h1 className="text-2xl font-bold" style={{ color: theme.primary }}>
              {selectedOption === 1 ? 'Golf Journey' :
               selectedOption === 2 ? 'Smart Profile' :
               'Coaching Profile'}
            </h1>
            <p className="text-base" style={{ color: theme.textSecondary }}>
              {selectedOption === 1 ? 'Member since August 2025' :
               selectedOption === 2 ? 'AI-personalized experience' :
               'Your coaching journey since August 2025'}
            </p>
          </div>
        </div>
      </div>

      <div className="p-6 space-y-4">
        {/* Profile sections would go here */}
        <div className="bg-white p-4 rounded-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Target size={20} style={{ color: theme.accent }} />
              <span className="font-medium">
                {selectedOption === 1 ? 'Current Goals' :
                 selectedOption === 2 ? 'Smart Goals' :
                 'Your Goals'}
              </span>
            </div>
            <span className="text-sm" style={{ color: theme.textSecondary }}>3 active</span>
          </div>
        </div>

        <div className="bg-white p-4 rounded-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Settings size={20} style={{ color: theme.primary }} />
              <span className="font-medium">
                {selectedOption === 1 ? 'Preferences' :
                 selectedOption === 2 ? 'AI Preferences' :
                 'Coaching Style'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="max-w-md mx-auto bg-white shadow-2xl rounded-2xl overflow-hidden">
      {/* Option Selector */}
      <div className="p-4 bg-gray-100 border-b">
        <div className="flex space-x-2">
          {[1, 2, 3].map(option => (
            <button
              key={option}
              onClick={() => setSelectedOption(option)}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                selectedOption === option 
                  ? 'bg-blue-500 text-white' 
                  : 'bg-white text-gray-600 hover:bg-gray-50'
              }`}
            >
              Option {option}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-600 mt-2">
          {selectedOption === 1 && 'Minimalist Coaching Journey'}
          {selectedOption === 2 && 'Intelligent Dashboard'}
          {selectedOption === 3 && 'AI Coach Presence (No Avatar)'}
        </p>
      </div>

      {/* Screen Content */}
      <div className="h-[600px] overflow-hidden">
        {activeTab === 'chat' && <ChatScreen />}
        {activeTab === 'summary' && <SummaryScreen />}
        {activeTab === 'videos' && <VideosScreen />}
        {activeTab === 'profile' && <ProfileScreen />}
      </div>

      {/* Tab Bar */}
      <TabBar />
    </div>
  );
};

export default GolfUIOptionsDemo;