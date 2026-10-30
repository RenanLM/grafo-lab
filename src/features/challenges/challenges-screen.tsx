import { Badge } from '@/components/badge';
import { Card } from '@/components/card';
import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';

export function ChallengesScreen() {
  return (
    <Screen title="Desafios" subtitle="Pratique o que você aprendeu.">
      <Card>
        <EmptyState
          title="Ainda não há desafios"
          description="Os exercícios vão verificar suas respostas por critérios matemáticos, e não por comparação de texto, e dar dicas graduais em vez de entregar a solução de cara.">
          <Badge label="Desafios em breve" centered />
        </EmptyState>
      </Card>
    </Screen>
  );
}
