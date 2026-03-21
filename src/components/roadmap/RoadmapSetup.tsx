import { useState, memo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Map, Sparkles } from 'lucide-react';

interface RoadmapSetupProps {
  onGenerate: (subject: string) => void;
  onBack: () => void;
  isGenerating: boolean;
}

const RoadmapSetup = memo(({ onGenerate, onBack, isGenerating }: RoadmapSetupProps) => {
  const [subject, setSubject] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (subject.trim()) {
      onGenerate(subject.trim());
    }
  };

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 relative">
      {/* Back button positioned in the content area, not overlapping sidebar */}
      <div className="absolute top-4 right-4">
        <Button variant="outline" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to Chat
        </Button>
      </div>

      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-3">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
            <Map className="h-8 w-8 text-primary" />
          </div>
          <h2 className="text-2xl font-bold text-foreground">Build Your Roadmap</h2>
          <p className="text-muted-foreground">Enter a subject and we'll create a personalized learning path with curated online resources.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="e.g. Python, Machine Learning, Web Dev..."
            className="h-12 text-base"
            disabled={isGenerating}
          />
          <Button type="submit" className="w-full h-12 gap-2" disabled={!subject.trim() || isGenerating}>
            {isGenerating ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Build Your Roadmap
              </>
            )}
          </Button>
        </form>
      </div>
    </div>
  );
});

RoadmapSetup.displayName = 'RoadmapSetup';
export default RoadmapSetup;
