import { Badge } from '@/components/badge';
import { Card } from '@/components/card';
import { Screen } from '@/components/screen';
import { Text } from '@/components/text';
import { STUDY_UNITS } from '@/features/lessons/units';

export function LessonsScreen() {
  return (
    <Screen
      title="Aprender"
      subtitle="Três unidades, dos conceitos básicos aos tópicos avançados.">
      {STUDY_UNITS.map((unit) => (
        <Card key={unit.id}>
          <Text variant="caption" color="textSecondary">
            {`Unidade ${unit.number} · ${unit.hours} h`}
          </Text>
          <Text variant="heading">{unit.title}</Text>
          <Text color="textSecondary">{unit.summary}</Text>
          <Badge label="Aulas em breve" />
        </Card>
      ))}
    </Screen>
  );
}
