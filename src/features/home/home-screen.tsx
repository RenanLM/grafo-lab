import { ActionCard } from '@/components/action-card';
import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';

export function HomeScreen() {
  return (
    <Screen title="GrafoLab" subtitle="Teoria dos Grafos para quem está começando.">
      <ActionCard
        href="/laboratorio"
        title="Abrir o Laboratório"
        description="O espaço onde você vai construir e explorar os seus próprios grafos."
      />
      <ActionCard
        href="/aprender"
        title="Ver a trilha de estudos"
        description="As três unidades da disciplina, dos fundamentos aos tópicos avançados."
      />
      <ActionCard
        href="/desafios"
        title="Conhecer os desafios"
        description="Exercícios para praticar com feedback e dicas graduais."
      />
      <Card>
        <Text variant="label">Seu progresso</Text>
        <Text color="textSecondary">
          Seu avanço aparecerá aqui quando as aulas e os desafios estiverem disponíveis.
        </Text>
      </Card>
    </Screen>
  );
}
